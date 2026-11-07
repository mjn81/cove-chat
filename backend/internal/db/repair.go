package db

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	badger "github.com/dgraph-io/badger/v4"
	"github.com/dgraph-io/badger/v4/pb"
	"google.golang.org/protobuf/proto"
)

// RepairReport says what Repair did.
type RepairReport struct {
	// Removed lists the damaged table files that were dropped, by file name.
	Removed []string
	// BackupDir is the copy of the original database kept before anything was changed. Empty when nothing needed
	// repairing.
	BackupDir string
}

// manifestFile is Badger's table-of-contents file; badgerCRC is the checksum table it protects each entry with.
const manifestFile = "MANIFEST"

var badgerCRC = crc32.MakeTable(crc32.Castagnoli)

// Repair makes a database that Open refuses because of zero-filled table files usable again, losing only what was
// stored in those tables. It copies the whole directory to "<path>.bak-<time>" first, rewrites the MANIFEST without
// the damaged tables and deletes them. A healthy database is left untouched. The server must be stopped.
//
// Anything that only lived in a damaged table, for example the newest messages or sessions, is gone for good; the
// rest of the data and the encryption keys are unaffected.
func Repair(path string) (RepairReport, error) {
	var report RepairReport
	damaged, err := damagedTables(path)
	if err != nil {
		return report, err
	}
	if len(damaged) == 0 {
		return report, nil
	}

	backup := fmt.Sprintf("%s.bak-%s", filepath.Clean(path), time.Now().Format("20060102-150405"))
	if err := copyDir(path, backup); err != nil {
		return report, fmt.Errorf("db: back up %s before repair: %w", path, err)
	}
	report.BackupDir = backup

	ids := make(map[uint64]bool, len(damaged))
	for _, name := range damaged {
		id, err := tableID(name)
		if err != nil {
			return report, err
		}
		ids[id] = true
	}
	if err := rewriteManifestWithout(path, ids); err != nil {
		return report, err
	}
	for _, name := range damaged {
		if err := os.Remove(filepath.Join(path, name)); err != nil {
			return report, fmt.Errorf("db: remove damaged table %s: %w", name, err)
		}
		report.Removed = append(report.Removed, name)
	}
	return report, nil
}

// damagedTables returns the base names of the zero-filled or empty .sst files in dir.
func damagedTables(dir string) ([]string, error) {
	tables, err := filepath.Glob(filepath.Join(dir, "*.sst"))
	if err != nil {
		return nil, fmt.Errorf("db: list tables in %s: %w", dir, err)
	}
	var bad []string
	for _, name := range tables {
		zero, err := isAllZero(name)
		if err != nil {
			return nil, fmt.Errorf("db: inspect table %s: %w", name, err)
		}
		if zero {
			bad = append(bad, filepath.Base(name))
		}
	}
	return bad, nil
}

// tableID turns "000011.sst" into 11.
func tableID(name string) (uint64, error) {
	id, err := strconv.ParseUint(strings.TrimSuffix(name, ".sst"), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("db: unexpected table file name %q", name)
	}
	return id, nil
}

// rewriteManifestWithout replays the MANIFEST, drops the given table ids and writes the result back atomically
// (new file, fsync, rename), in Badger's own format: an 8 byte header, then one length+CRC framed change set.
func rewriteManifestWithout(dir string, drop map[uint64]bool) error {
	manifestPath := filepath.Join(dir, manifestFile)
	fp, err := os.Open(manifestPath)
	if err != nil {
		return fmt.Errorf("db: open MANIFEST: %w", err)
	}
	header := make([]byte, 8)
	if _, err := io.ReadFull(fp, header); err != nil {
		_ = fp.Close()
		return fmt.Errorf("db: read MANIFEST header: %w", err)
	}
	if _, err := fp.Seek(0, io.SeekStart); err != nil {
		_ = fp.Close()
		return err
	}
	// The two bytes after the "Bdgr" tag are the external magic number, which Badger insists on getting back.
	manifest, _, err := badger.ReplayManifestFile(fp, binary.BigEndian.Uint16(header[4:6]), badger.DefaultOptions(dir))
	_ = fp.Close()
	if err != nil {
		return fmt.Errorf("db: read MANIFEST: %w", err)
	}

	set := pb.ManifestChangeSet{}
	for id, tm := range manifest.Tables {
		if drop[id] {
			continue
		}
		set.Changes = append(set.Changes, &pb.ManifestChange{
			Id:             id,
			Op:             pb.ManifestChange_CREATE,
			Level:          uint32(tm.Level),
			KeyId:          tm.KeyID,
			EncryptionAlgo: pb.EncryptionAlgo_aes,
			Compression:    uint32(tm.Compression),
		})
	}
	body, err := proto.Marshal(&set)
	if err != nil {
		return fmt.Errorf("db: encode MANIFEST: %w", err)
	}
	var framing [8]byte
	binary.BigEndian.PutUint32(framing[0:4], uint32(len(body)))
	binary.BigEndian.PutUint32(framing[4:8], crc32.Checksum(body, badgerCRC))

	var out bytes.Buffer
	out.Write(header)
	out.Write(framing[:])
	out.Write(body)

	tmp := filepath.Join(dir, "MANIFEST-REWRITE")
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("db: write MANIFEST: %w", err)
	}
	if _, err := f.Write(out.Bytes()); err != nil {
		_ = f.Close()
		return fmt.Errorf("db: write MANIFEST: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return fmt.Errorf("db: sync MANIFEST: %w", err)
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, manifestPath); err != nil {
		return fmt.Errorf("db: replace MANIFEST: %w", err)
	}
	return nil
}

// copyDir copies the files of src (the database is a flat directory) into a new directory dst.
func copyDir(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0o700); err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if err := copyFile(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string) (err error) {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := out.Close(); err == nil {
			err = cerr
		}
	}()
	_, err = io.Copy(out, in)
	return err
}
