# Installs OfficeBuffet as a Windows service that starts with Windows, and opens its port in the firewall.
# Run in an elevated PowerShell (Run as Administrator) from the app folder:
#   powershell -ExecutionPolicy Bypass -File .\install-service.ps1            (port 5080)
#   powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -Port 80
param([int]$Port = 5080)

$ErrorActionPreference = 'Stop'
$name = 'OfficeBuffet'
$exe = Join-Path $PSScriptRoot 'OfficeBuffet.exe'
if (-not (Test-Path $exe)) { throw "OfficeBuffet.exe not found next to this script ($PSScriptRoot)." }

# 'OfficeBite' is the service name from before the rename; remove it so the two don't fight over the port.
foreach ($old in @($name, 'OfficeBite')) {
    if (Get-Service $old -ErrorAction SilentlyContinue) {
        Stop-Service $old -ErrorAction SilentlyContinue
        sc.exe delete $old | Out-Null
        Start-Sleep -Seconds 2
    }
}
Get-NetFirewallRule -DisplayName 'OfficeBite *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-Service -Name $name -DisplayName 'OfficeBuffet' -Description 'Office pantry orders and reports' -StartupType Automatic `
    -BinaryPathName "`"$exe`" --Urls=http://0.0.0.0:$Port" | Out-Null
sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

if (-not (Get-NetFirewallRule -DisplayName "OfficeBuffet $Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "OfficeBuffet $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}

Start-Service $name
Write-Host "OfficeBuffet is running as a service on port $Port." -ForegroundColor Green
