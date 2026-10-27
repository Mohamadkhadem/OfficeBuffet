# Creates an HTTPS certificate for OfficeBuffet on the office network, so phones can use notifications
# and install the app without a public domain.
#
#   powershell -ExecutionPolicy Bypass -File .\tools\new-certificate.ps1
#   powershell -ExecutionPolicy Bypass -File .\tools\new-certificate.ps1 -IpAddresses 192.168.1.10,10.0.0.5
#
# This PC's own addresses are always included; pass the server's addresses with -IpAddresses when
# the certificate is for another machine.
#
# Output in .\certs:
#   officebuffet-ca.cer   install once on every phone (and PC) that should trust the app
#   officebuffet.pfx      the server certificate Kestrel uses
#   kestrel.json          tells the app to use officebuffet.pfx (read automatically at startup)
#
# On the server, copy the certs folder next to OfficeBuffet.exe and add an https URL (see DEPLOY.md).
#
# The private key of the CA is deleted right after signing, so the certificate people install on
# their phones can never be used to vouch for any other site. To add an IP later, run this again
# (phones then need the new officebuffet-ca.cer).
param(
    [string[]]$IpAddresses = @(),
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'certs')
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null

# Always include this PC's LAN addresses and localhost, for testing.
$local = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object IPAddress
$ips = @($IpAddresses + $local + '127.0.0.1' | Select-Object -Unique)
$san = (($ips | ForEach-Object { "IPAddress=$_" }) + 'DNS=localhost') -join '&'

$ca = New-SelfSignedCertificate -Subject 'CN=OfficeBuffet Local CA' -FriendlyName 'OfficeBuffet Local CA' `
    -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -KeyUsage CertSign, CRLSign, DigitalSignature -NotAfter (Get-Date).AddYears(10) `
    -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0')

try {
    # iOS rejects server certificates valid for more than 825 days.
    $server = New-SelfSignedCertificate -Subject 'CN=OfficeBuffet' -FriendlyName 'OfficeBuffet' -Signer $ca `
        -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable -KeyUsage DigitalSignature, KeyEncipherment -NotAfter (Get-Date).AddDays(820) `
        -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1', '2.5.29.19={text}ca=0')

    $password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    Export-Certificate -Cert $ca -FilePath (Join-Path $OutDir 'officebuffet-ca.cer') | Out-Null
    Export-PfxCertificate -Cert $server -FilePath (Join-Path $OutDir 'officebuffet.pfx') -ChainOption EndEntityCertOnly `
        -Password (ConvertTo-SecureString $password -AsPlainText -Force) | Out-Null
    $kestrel = @{ Kestrel = @{ Certificates = @{ Default = @{ Path = 'certs/officebuffet.pfx'; Password = $password } } } }
    Set-Content -Path (Join-Path $OutDir 'kestrel.json') -Value ($kestrel | ConvertTo-Json -Depth 5) -Encoding ascii
}
finally {
    # Nothing stays in the certificate store; the CA key is gone for good.
    Remove-Item "Cert:\CurrentUser\My\$($ca.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue
    if ($server) { Remove-Item "Cert:\CurrentUser\My\$($server.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue }
}

Write-Host "Certificate created for: $($ips -join ', '), localhost" -ForegroundColor Green
Write-Host "Install $OutDir\officebuffet-ca.cer on the phones; the server uses officebuffet.pfx."
