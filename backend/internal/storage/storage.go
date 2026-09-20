package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// BlobStorage defines how binary assets (files, voice notes) are persisted.
type BlobStorage interface {
	Save(id string, r io.Reader) (string, int64, error) // Returns relative storage path, size, and error
	Open(path string) (io.ReadCloser, error)
	Delete(path string) error
}

// FileSystemStorage implements BlobStorage using the local disk.
type FileSystemStorage struct {
	BaseDir string
}

func (s *FileSystemStorage) Save(id string, r io.Reader) (string, int64, error) {
	if err := os.MkdirAll(s.BaseDir, 0755); err != nil {
		return "", 0, fmt.Errorf("storage: failed to create base dir: %w", err)
	}

	path := filepath.Join(s.BaseDir, id)
	f, err := os.Create(path)
	if err != nil {
		return "", 0, fmt.Errorf("storage: failed to create file: %w", err)
	}
	defer f.Close()

	n, err := io.Copy(f, r)
	if err != nil {
		f.Close()
		_ = os.Remove(path)
		return "", 0, fmt.Errorf("storage: failed to write data: %w", err)
	}

	return path, n, nil
}

func (s *FileSystemStorage) Open(path string) (io.ReadCloser, error) {
	return os.Open(path)
}

func (s *FileSystemStorage) Delete(path string) error {
	return os.Remove(path)
}

// TODO: Implement S3Storage struct here or in a separate file when needed.
