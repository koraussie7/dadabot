# Security Policy

## 🔐 Supported Versions

| Version | Supported |
|---------|-----------|
| Latest stable | ✅ |
| Latest beta | ✅ |
| Nightly | ⚠️ Best effort |
| Older | ❌ |

## 🛡 Security Features

### Local-First Architecture
- **Zero cloud dependencies** by default
- All data stored locally (Markdown + SQLite)
- API keys stored in local environment files only
- Ollama = fully offline operation

### Signed Releases
- All artifacts signed with **minisign** (Ed25519)
- SHA-256 checksums in manifest
- Auto-updater verifies both before applying
- Transparent signature verification

### Human-in-the-Loop
- 3-tier permission model: `read` | `changeRequest` | `autoMerge`
- Risk-based escalation (critical → mandatory approval)
- GitHub PR bridge for non-technical review
- Audit log for all decisions

### Secure Updates
- Manifest served via HTTPS + Cloudflare CDN
- SHA-256 + minisign verification before apply
- Atomic binary replacement (POSIX)
- Staged updates with rollback (Windows)

## 🐛 Reporting Vulnerabilities

**DO NOT** open public issues for security vulnerabilities.

### Report via Email
```
To: security@dadabot.dev
Subject: [SECURITY] Brief description
```

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

### Response Timeline
| Severity | Response | Fix Target |
|----------|----------|------------|
| Critical | 24 hours | 72 hours |
| High | 48 hours | 1 week |
| Medium | 1 week | 2 weeks |
| Low | 2 weeks | Next release |

## 🔒 Security Best Practices for Users

### Installation
```bash
# Verify signature after download
minisign -V -p minisign.pub -m dadabot-*.tar.gz

# Check SHA-256
sha256sum dadabot-*.tar.gz
```

### Configuration
```bash
# Store API keys in .env (never commit)
echo "OPENAI_API_KEY=sk-..." > ~/.dadabot/.env
chmod 600 ~/.dadabot/.env

# Use Ollama for fully offline
ollama pull llama3.2:3b
```

### Network
- DadaBot works **fully offline** with Ollama
- Cloud models only used when explicitly configured
- P2P sync uses encrypted WebRTC (libp2p)
- No telemetry without explicit opt-in

## 🔍 Security Audit

### Code
- All dependencies pinned in `pnpm-lock.yaml`
- `pnpm audit` run in CI
- No `eval`, `Function` constructor, or dynamic imports
- Content Security Policy in web app

### Dependencies
- Minimal dependency footprint
- Regular `pnpm audit` and updates
- License compatibility (MIT/Apache-2.0 only)

### Infrastructure
- GitHub Actions with pinned actions (`@v4`)
- Minimal permissions in workflows
- Secrets via GitHub encrypted secrets
- Minisign private key never in repo

## 🏷 Security Labels

| Label | Meaning |
|-------|---------|
| `security` | Security-related issue/PR |
| `vulnerability` | Confirmed vulnerability |
| `crypto` | Cryptography-related |
| `auth` | Authentication/authorization |

## 📋 Incident Response

1. **Acknowledge** within 24 hours
2. **Assess** impact and severity
3. **Contain** if active exploit
4. **Fix** with minimal disruption
5. **Verify** fix with tests
6. **Release** patch version
6. **Communicate** to users
7. **Post-mortem** within 1 week

## 📞 Contact

- **Security Email**: security@dadabot.dev
- **PGP Key**: Available on request
- **Bug Bounty**: Not currently offered

---

**Last Updated**: 2026-10-19
**Policy Version**: 1.0