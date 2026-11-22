//go:build !linux

package httpapi

func memoryBacked(_ string) bool { return false }
