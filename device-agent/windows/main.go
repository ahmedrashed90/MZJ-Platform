//go:build windows

package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	agentVersion = "1.1.0"
	appName      = "MZJ Device Agent"
)

type dataBlob struct {
	cbData uint32
	pbData *byte
}

type identity struct {
	DeviceID            string `json:"deviceId"`
	PublicKeyPEM        string `json:"publicKeyPem"`
	ProtectedPrivateKey string `json:"protectedPrivateKey"`
	CreatedAt           string `json:"createdAt"`
}

type verifyRequest struct {
	ChallengeID     string `json:"challengeId"`
	DeviceID        string `json:"deviceId"`
	DeviceName      string `json:"deviceName"`
	Platform        string `json:"platform"`
	AgentVersion    string `json:"agentVersion"`
	PublicKeyPEM    string `json:"publicKeyPem"`
	FingerprintHash string `json:"fingerprintHash"`
	Signature       string `json:"signature"`
}

type verifyResponse struct {
	OK         bool   `json:"ok"`
	Status     string `json:"status"`
	Error      string `json:"error"`
	DeviceName string `json:"deviceName"`
}

var (
	crypt32                = syscall.NewLazyDLL("crypt32.dll")
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	user32                 = syscall.NewLazyDLL("user32.dll")
	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	procLocalFree          = kernel32.NewProc("LocalFree")
	procMessageBoxW        = user32.NewProc("MessageBoxW")
)

func main() {
	if len(os.Args) > 1 && strings.HasPrefix(strings.ToLower(os.Args[1]), "mzjagent://") {
		if err := handleProtocol(os.Args[1]); err != nil {
			messageBox("تعذر التحقق من جهاز العمل\n"+err.Error(), true)
		}
		return
	}
	if err := installAgent(); err != nil {
		messageBox("تعذر تثبيت MZJ Device Agent\n"+err.Error(), true)
		return
	}
	messageBox("تم تثبيت MZJ Device Agent بنجاح على هذا الجهاز.", false)
}

func messageBox(message string, isError bool) {
	title, _ := syscall.UTF16PtrFromString(appName)
	text, _ := syscall.UTF16PtrFromString(message)
	flags := uintptr(0x00000040) // information
	if isError {
		flags = 0x00000010 // error
	}
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), flags)
}

func appDir() (string, error) {
	base := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if base == "" {
		return "", errors.New("LOCALAPPDATA غير متاح")
	}
	return filepath.Join(base, "MZJ", "DeviceAgent"), nil
}

func installAgent() error {
	dir, err := appDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	current, err := os.Executable()
	if err != nil {
		return err
	}
	destination := filepath.Join(dir, "MZJDeviceAgent.exe")
	currentAbs, _ := filepath.Abs(current)
	destinationAbs, _ := filepath.Abs(destination)
	if !strings.EqualFold(currentAbs, destinationAbs) {
		if err := copyFile(current, destination); err != nil {
			return err
		}
	}
	if _, err := loadOrCreateIdentity(dir); err != nil {
		return err
	}
	return registerProtocol(destination)
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0700)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

func registerProtocol(exePath string) error {
	base := `HKCU\Software\Classes\mzjagent`
	commands := [][]string{
		{"add", base, "/ve", "/d", "URL:MZJ Device Agent", "/f"},
		{"add", base, "/v", "URL Protocol", "/d", "", "/f"},
		{"add", base + `\DefaultIcon`, "/ve", "/d", exePath + ",0", "/f"},
		{"add", base + `\shell\open\command`, "/ve", "/d", `"` + exePath + `" "%1"`, "/f"},
	}
	for _, args := range commands {
		if output, err := exec.Command("reg.exe", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("تعذر تسجيل بروتوكول الجهاز: %s", strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func identityPath(dir string) string {
	return filepath.Join(dir, "identity.json")
}

func loadOrCreateIdentity(dir string) (*identity, error) {
	path := identityPath(dir)
	if raw, err := os.ReadFile(path); err == nil {
		var saved identity
		if json.Unmarshal(raw, &saved) == nil && saved.DeviceID != "" && saved.PublicKeyPEM != "" && saved.ProtectedPrivateKey != "" {
			return &saved, nil
		}
	}

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return nil, err
	}
	protected, err := protectData(privateDER)
	if err != nil {
		return nil, fmt.Errorf("تعذر حماية مفتاح الجهاز: %w", err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return nil, err
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	digest := sha256.Sum256(publicDER)
	deviceID := "MZJ-WIN-" + strings.ToUpper(hex.EncodeToString(digest[:10]))
	created := &identity{
		DeviceID:            deviceID,
		PublicKeyPEM:        publicPEM,
		ProtectedPrivateKey: base64.StdEncoding.EncodeToString(protected),
		CreatedAt:           time.Now().UTC().Format(time.RFC3339),
	}
	raw, _ := json.MarshalIndent(created, "", "  ")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		return nil, err
	}
	return created, nil
}

func blobFromBytes(data []byte) dataBlob {
	if len(data) == 0 {
		return dataBlob{}
	}
	return dataBlob{cbData: uint32(len(data)), pbData: &data[0]}
}

func bytesFromBlob(blob dataBlob) []byte {
	if blob.cbData == 0 || blob.pbData == nil {
		return nil
	}
	return append([]byte(nil), unsafe.Slice(blob.pbData, int(blob.cbData))...)
}

func protectData(data []byte) ([]byte, error) {
	input := blobFromBytes(data)
	var output dataBlob
	ret, _, callErr := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&input)),
		0, 0, 0, 0,
		uintptr(0x1), // CRYPTPROTECT_UI_FORBIDDEN
		uintptr(unsafe.Pointer(&output)),
	)
	if ret == 0 {
		return nil, callErr
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(output.pbData)))
	return bytesFromBlob(output), nil
}

func unprotectData(data []byte) ([]byte, error) {
	input := blobFromBytes(data)
	var output dataBlob
	ret, _, callErr := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&input)),
		0, 0, 0, 0,
		uintptr(0x1),
		uintptr(unsafe.Pointer(&output)),
	)
	if ret == 0 {
		return nil, callErr
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(output.pbData)))
	return bytesFromBlob(output), nil
}

func loadPrivateKey(saved *identity) (*ecdsa.PrivateKey, error) {
	protected, err := base64.StdEncoding.DecodeString(saved.ProtectedPrivateKey)
	if err != nil {
		return nil, err
	}
	privateDER, err := unprotectData(protected)
	if err != nil {
		return nil, err
	}
	key, err := x509.ParsePKCS8PrivateKey(privateDER)
	if err != nil {
		return nil, err
	}
	ecdsaKey, ok := key.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("مفتاح الجهاز غير صالح")
	}
	return ecdsaKey, nil
}

func handleProtocol(rawURL string) error {
	if err := installAgent(); err != nil {
		return err
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return errors.New("رابط التحقق غير صالح")
	}
	if !strings.EqualFold(parsed.Scheme, "mzjagent") || !strings.EqualFold(parsed.Host, "verify") {
		return errors.New("طلب التحقق غير معروف")
	}
	challengeID := strings.TrimSpace(parsed.Query().Get("challengeId"))
	challenge := strings.TrimSpace(parsed.Query().Get("challenge"))
	server := strings.TrimRight(strings.TrimSpace(parsed.Query().Get("server")), "/")
	if challengeID == "" || challenge == "" || server == "" {
		return errors.New("بيانات التحقق غير مكتملة")
	}
	if !allowedServer(server) {
		return errors.New("عنوان المنصة غير معتمد")
	}

	dir, _ := appDir()
	saved, err := loadOrCreateIdentity(dir)
	if err != nil {
		return err
	}
	privateKey, err := loadPrivateKey(saved)
	if err != nil {
		return fmt.Errorf("تعذر قراءة مفتاح الجهاز: %w", err)
	}
	payload := []byte("MZJ-DEVICE-LOGIN|v1|" + challengeID + "|" + challenge)
	digest := sha256.Sum256(payload)
	signature, err := ecdsa.SignASN1(rand.Reader, privateKey, digest[:])
	if err != nil {
		return err
	}
	computerName, _ := os.Hostname()
	requestBody := verifyRequest{
		ChallengeID:     challengeID,
		DeviceID:        saved.DeviceID,
		DeviceName:      computerName,
		Platform:        "windows",
		AgentVersion:    agentVersion,
		PublicKeyPEM:    saved.PublicKeyPEM,
		FingerprintHash: hardwareFingerprint(),
		Signature:       base64.StdEncoding.EncodeToString(signature),
	}
	body, _ := json.Marshal(requestBody)
	httpRequest, err := http.NewRequest(http.MethodPost, server+"/api/device-agent", bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("User-Agent", "MZJ-Device-Agent/"+agentVersion)
	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(httpRequest)
	if err != nil {
		return fmt.Errorf("تعذر الاتصال بالمنصة: %w", err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 1024*1024))
	var result verifyResponse
	_ = json.Unmarshal(responseBody, &result)
	if response.StatusCode < 200 || response.StatusCode >= 300 || !result.OK {
		if result.Error != "" {
			return errors.New(result.Error)
		}
		return fmt.Errorf("رفضت المنصة التحقق (%d)", response.StatusCode)
	}
	switch result.Status {
	case "approved":
		messageBox("تم التحقق من جهاز العمل بنجاح.", false)
	case "pending":
		messageBox("تم تسجيل الجهاز وهو في انتظار اعتماد مدير النظام.", false)
	case "revoked":
		messageBox("هذا الجهاز غير معتمد. تواصل مع مدير النظام.", true)
	default:
		messageBox("تم إرسال بيانات الجهاز إلى المنصة.", false)
	}
	return nil
}

func allowedServer(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if parsed.Scheme == "https" && host == "mzj-platform.vercel.app" {
		return true
	}
	if parsed.Scheme == "http" && (host == "localhost" || host == "127.0.0.1") {
		return true
	}
	return false
}

func commandOutput(name string, args ...string) string {
	command := exec.Command(name, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func hardwareFingerprint() string {
	hostname, _ := os.Hostname()
	machineGuid := commandOutput("reg.exe", "query", `HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid")
	bios := commandOutput("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue).SerialNumber`)
	board := commandOutput("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue).SerialNumber`)
	value := strings.Join([]string{strings.TrimSpace(hostname), machineGuid, bios, board}, "|")
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
