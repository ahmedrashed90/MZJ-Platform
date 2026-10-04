# MZJ Device Agent for Windows

`MZJ-Device-Agent-Setup.exe` is both the one-time installer and the protocol handler. The default production build targets Windows x86 so the same installer runs on both 32-bit and 64-bit Intel/AMD Windows installations (and Windows ARM systems that provide x86 emulation).

- Installs per Windows user under `%LOCALAPPDATA%\MZJ\DeviceAgent`.
- Registers `mzjagent://` in HKCU.
- Generates an ECDSA P-256 key pair once.
- Protects the private key with Windows DPAPI; the private key never leaves the PC.
- Sends only Device ID, public key, hashed hardware fingerprint and challenge signature to MZJ Platform.
- Login challenges are short-lived and one-time.

Production origin: `https://mzj-platform.vercel.app`.
