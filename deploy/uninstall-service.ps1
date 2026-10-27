# Removes the OfficeBuffet Windows service (data in App_Data is kept). Run as Administrator.
# Also removes 'OfficeBite', the service name from before the rename, if it is still there.
foreach ($name in @('OfficeBuffet', 'OfficeBite')) {
    Stop-Service $name -ErrorAction SilentlyContinue
    sc.exe delete $name 2>$null | Out-Null
}
Get-NetFirewallRule -DisplayName 'OfficeBuffet *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName 'OfficeBite *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'OfficeBuffet service removed. App_Data (database and keys) was not touched.'
