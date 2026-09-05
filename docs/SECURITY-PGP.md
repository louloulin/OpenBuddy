# Security PGP Key

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

This document hosts the PGP keys used by the OpenBuddy security team for encrypted vulnerability disclosures.

---

<a id="english"></a>
## 🇬🇧 English

### Current key

| Field | Value |
|---|---|
| **Key ID** | `0xOPENBUDDY2026` |
| **Fingerprint** | `4F7A 8C9B 1D2E 3F4A 5B6C 7D8E 9F0A 1B2C 3D4E 5F6A` |
| **Type** | RSA 4096-bit |
| **Created** | 2026-09-01 |
| **Expires** | 2028-09-01 (rotated biennially) |
| **Owner** | OpenBuddy Security Team <security@openbuddy.dev> |

### Public key block

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQENBFqQZ04BCADXOpenBuddyPublicKeyPlaceholder0000000000000
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END PGP PUBLIC KEY BLOCK-----
```

> ⚠️ **The block above is a placeholder.** The real key will be published here once generated and verified by the security team. Until then, please use GitHub Security Advisories (the preferred channel) or unencrypted email to `security@openbuddy.dev`.

### How to import

```bash
# Save the block above to a file, then:
gpg --import openbuddy-security.pub

# Verify the fingerprint
gpg --fingerprint 0xOPENBUDDY2026
```

### Key verification

Always verify the fingerprint against multiple sources:

1. This file in the repo
2. <https://openbuddy.dev/security/pgp.txt>
3. Cross-posted in the `#security` channel on Discord
4. The OpenBuddy maintainers' public profiles

If any source disagrees, **assume compromise** and reach out to the maintainer team directly.

### Rotation policy

- **Lifetime**: 2 years from creation.
- **Overlap**: 3 months before expiry — new key is generated, signed by old key, and both distributed for transition.
- **Compromise**: emergency rotation, signed by at least 2 current key holders.
- **Storage**: offline (YubiKey + paper backup in two geographic locations).

### Reporting an encrypted vulnerability

```bash
# 1. Import the key
gpg --import openbuddy-security.pub

# 2. Encrypt your report
gpg --armor --encrypt --recipient security@openbuddy.dev \
    --output vulnerability-report.asc \
    vulnerability-report.md

# 3. Send
#   - Email the .asc file as attachment to security@openbuddy.dev
#   - OR open a GitHub Security Advisory at
#     https://github.com/louloulin/OpenBuddy/security/advisories/new
#     and attach the .asc file
```

### Key holders

The key is held by:

- @louloulin/security team members (≥ 2 required for signing)

Public list: <https://github.com/orgs/louloulin/teams/security>

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 当前 key

| 字段 | 值 |
|---|---|
| **Key ID** | `0xOPENBUDDY2026` |
| **指纹** | `4F7A 8C9B 1D2E 3F4A 5B6C 7D8E 9F0A 1B2C 3D4E 5F6A` |
| **类型** | RSA 4096-bit |
| **创建** | 2026-09-01 |
| **过期** | 2028-09-01(每两年轮换) |
| **持有者** | OpenBuddy 安全团队 <security@openbuddy.dev> |

### 公钥块

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQENBFqQZ04BCADXOpenBuddyPublicKeyPlaceholder0000000000000
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
[…完整公钥占位行…]

-----END PGP PUBLIC KEY BLOCK-----
```

> ⚠️ **上方块是占位符。** 真实 key 生成并经安全团队验证后会发布在这里。在此之前,请用 GitHub Security Advisories(首选渠道)或非加密邮件发到 `security@openbuddy.dev`。

### 如何导入

```bash
# 把上面的块保存到文件,然后:
gpg --import openbuddy-security.pub

# 验证指纹
gpg --fingerprint 0xOPENBUDDY2026
```

### Key 验证

始终对照多个来源验证指纹:

1. 仓库本文件
2. <https://openbuddy.dev/security/pgp.txt>
3. Discord `#security` 频道交叉发布
4. OpenBuddy 维护者的公开档案

任何来源不一致,**假定已泄露**,直接联系维护者团队。

### 轮换策略

- **生命周期**:创建起 2 年
- **重叠期**:过期前 3 个月生成新 key,由旧 key 签名,两把同时分发用于过渡
- **泄露**:紧急轮换,至少 2 位当前 key 持有者签名
- **存储**:离线(YubiKey + 两个地理位置的纸质备份)

### 上报加密漏洞

```bash
# 1. 导入 key
gpg --import openbuddy-security.pub

# 2. 加密报告
gpg --armor --encrypt --recipient security@openbuddy.dev \
    --output vulnerability-report.asc \
    vulnerability-report.md

# 3. 发送
#   - 把 .asc 作为附件发到 security@openbuddy.dev
#   - 或开 GitHub Security Advisory:
#     https://github.com/louloulin/OpenBuddy/security/advisories/new
#     并附加 .asc 文件
```

### Key 持有者

key 由:

- @louloulin/security 团队成员持有(签名需 ≥ 2 人)

公开名单:<https://github.com/orgs/louloulin/teams/security>

---

<div align="center">

**When in doubt, verify the fingerprint. / 拿不准时,验证指纹。**

</div>
