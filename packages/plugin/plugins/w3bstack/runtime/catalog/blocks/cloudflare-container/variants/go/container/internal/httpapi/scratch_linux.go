package httpapi

import "syscall"

func memoryBacked(path string) bool {
	var fs syscall.Statfs_t
	return syscall.Statfs(path, &fs) == nil && fs.Type == 0x01021994
}
