package store

import "cove/backend/internal/models"

// Proxy methods on Store for db methods not directly accessed in store.go

func (s *Store) GetFile(id string) (*models.File, error) {
	return s.db.GetFile(id)
}

func (s *Store) UpdateFile(f *models.File) error {
	return s.db.SetFile(f)
}
