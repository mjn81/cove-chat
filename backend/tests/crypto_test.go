package tests

import (
	"bytes"
	"testing"

	"cove/backend/internal/crypto"
)

func TestHashAndVerifyPassword(t *testing.T) {
	t.Parallel()
	const pwd = "s3cur3P@ssword!"

	hash, err := crypto.HashPassword(pwd)
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}

	// Correct password should verify.
	ok, err := crypto.VerifyPassword(pwd, hash)
	if err != nil {
		t.Fatalf("VerifyPassword() error = %v", err)
	}
	if !ok {
		t.Error("VerifyPassword() = false, want true for correct password")
	}

	// Wrong password should not verify.
	ok, err = crypto.VerifyPassword("wrongpassword", hash)
	if err != nil {
		t.Fatalf("VerifyPassword() error = %v", err)
	}
	if ok {
		t.Error("VerifyPassword() = true, want false for wrong password")
	}
}

func TestHashPasswordDifferentSalts(t *testing.T) {
	t.Parallel()
	const pwd = "samepassword"
	hash1, err := crypto.HashPassword(pwd)
	if err != nil {
		t.Fatal(err)
	}
	hash2, err := crypto.HashPassword(pwd)
	if err != nil {
		t.Fatal(err)
	}
	// Two hashes of the same password should differ (different salts).
	if bytes.Equal(hash1, hash2) {
		t.Error("Two hashes of the same password are identical — salt not working")
	}
}

func TestGenerateAES256Key(t *testing.T) {
	t.Parallel()
	key, err := crypto.GenerateAES256Key()
	if err != nil {
		t.Fatalf("GenerateAES256Key() error = %v", err)
	}
	if len(key) != 32 {
		t.Errorf("key length = %d, want 32", len(key))
	}

	// Two keys should be different.
	key2, _ := crypto.GenerateAES256Key()
	if bytes.Equal(key, key2) {
		t.Error("Generated two identical AES keys — entropy source broken?")
	}
}

func TestEncryptDecryptAES256GCM(t *testing.T) {
	t.Parallel()
	key, err := crypto.GenerateAES256Key()
	if err != nil {
		t.Fatal(err)
	}

	plaintext := []byte("Hello, Cove! 🔐")
	ciphertext, err := crypto.EncryptAES256GCM(key, plaintext)
	if err != nil {
		t.Fatalf("EncryptAES256GCM() error = %v", err)
	}
	if bytes.Equal(ciphertext, plaintext) {
		t.Error("Ciphertext is identical to plaintext — encryption did nothing")
	}

	decrypted, err := crypto.DecryptAES256GCM(key, ciphertext)
	if err != nil {
		t.Fatalf("DecryptAES256GCM() error = %v", err)
	}
	if !bytes.Equal(decrypted, plaintext) {
		t.Errorf("Decrypted = %q, want %q", decrypted, plaintext)
	}
}

func TestDecryptWithWrongKey(t *testing.T) {
	t.Parallel()
	key1, _ := crypto.GenerateAES256Key()
	key2, _ := crypto.GenerateAES256Key()

	ciphertext, err := crypto.EncryptAES256GCM(key1, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}

	// Decryption with wrong key should fail.
	_, err = crypto.DecryptAES256GCM(key2, ciphertext)
	if err == nil {
		t.Error("DecryptAES256GCM() with wrong key succeeded — should have failed")
	}
}

func TestDeriveKEKDeterministic(t *testing.T) {
	t.Parallel()
	const masterPwd = "my-secret-master-password"
	kek1 := crypto.DeriveKEK(masterPwd)
	kek2 := crypto.DeriveKEK(masterPwd)

	if !bytes.Equal(kek1, kek2) {
		t.Error("DeriveKEK() is not deterministic — same password gave different KEKs")
	}
	if len(kek1) != 32 {
		t.Errorf("KEK length = %d, want 32", len(kek1))
	}
}

func TestEncryptDecryptDEK(t *testing.T) {
	t.Parallel()
	kek := crypto.DeriveKEK("master-password-for-test")
	dek, err := crypto.GenerateAES256Key()
	if err != nil {
		t.Fatal(err)
	}

	encryptedDEK, err := crypto.EncryptDEK(kek, dek)
	if err != nil {
		t.Fatalf("EncryptDEK() error = %v", err)
	}

	decryptedDEK, err := crypto.DecryptDEK(kek, encryptedDEK)
	if err != nil {
		t.Fatalf("DecryptDEK() error = %v", err)
	}

	if !bytes.Equal(dek, decryptedDEK) {
		t.Error("DEK roundtrip failed — decrypted DEK differs from original")
	}
}
