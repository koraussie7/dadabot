# install.Tests.ps1 — Pester tests for install.ps1
# Run: Invoke-Pester test/Install.Tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallScript = Join-Path (Split-Path -Parent $ScriptDir) "..\install.ps1"

BeforeAll {
    # Mock curl for manifest download
    function Mock-InvokeWebRequest {
        param([string]$Uri)
        if ($Uri -like "*latest-stable.json*") {
            return @{
                Content = @{
                    channel = "stable"
                    version = "0.1.0-test"
                    published_at = "2026-10-19T00:00:00Z"
                    minisign_pubkey = "RWQqHXfRYzE7kBvK1Lm8Np2Qs5Tv4Wx9Yz6A3F7G0Bc2D5E8H1J4M6N9P1R3S5T7V"
                    platforms = @{
                        "windows-x86_64" = @{
                            display_name = "Windows (x86_64)"
                            asset = "dadabot-0.1.0-test-windows-x86_64.zip"
                            download_url = "file:///tmp/dadabot-mock-assets/dadabot-0.1.0-test-windows-x86_64.zip"
                            signature_url = "file:///tmp/dadabot-mock-assets/dadabot-0.1.0-test-windows-x86_64.zip.sig"
                            sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                            size_bytes = 1024
                        }
                    }
                } | ConvertTo-Json -Depth 10
            }
        }
        throw "Unexpected URI: $Uri"
    }
    Set-Item -Path Function:\Invoke-WebRequest -Value $function:Mock-InvokeWebRequest -Force
    
    # Mock certutil for SHA256
    function Mock-certutil {
        param([string[]]$Args)
        if ($Args -contains "SHA256") {
            return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        }
        return "mock-hash"
    }
    Set-Item -Path Function:\certutil -Value $function:Mock-certutil -Force
    
    # Mock minisign
    function Mock-minisign {
        param([string[]]$Args)
        if ($Args -contains "-V") {
            Write-Host "Signature verified"
            return
        }
        if ($Args -contains "-S") {
            # Create .sig file
            $sigFile = $Args[-1] + ".sig"
            New-Item -Path $sigFile -ItemType File -Force | Out-Null
            return
        }
        return 1
    }
    Set-Item -Path Function:\minisign -Value $function:Mock-minisign -Force
    
    # Mock Expand-Archive
    function Mock-ExpandArchive {
        param($Path, $DestinationPath)
        New-Item -Path "$DestinationPath\bin\dadabot.exe" -ItemType File -Force | Out-Null
        "[System.Console]::WriteLine('DadaBot test binary')" | Out-File "$DestinationPath\bin\dadabot.exe" -Encoding ASCII
    }
    Set-Item -Path Function:\Expand-Archive -Value $function:Mock-ExpandArchive -Force
}

BeforeEach {
    # Reset mocks
    $global:mockCallCount = 0
}

AfterAll {
    # Cleanup mocks
    Remove-Item -Path Function:\Invoke-WebRequest -Force -ErrorAction SilentlyContinue
    Remove-Item -Path Function:\certutil -Force -ErrorAction SilentlyContinue
    Remove-Item -Path Function:\minisign -Force -ErrorAction SilentlyContinue
    Remove-Item -Path Function:\Expand-Archive -Force -ErrorAction SilentlyContinue
}

Describe "install.ps1" {
    Context "Help and version" {
        It "Shows usage with -Help" {
            & "$InstallScript" -Help | Should -Match "Usage"
        }
        
        It "Shows version with -Version" {
            & "$InstallScript" -Version | Should -Match "0\.1\.0"
        }
    }
    
    Context "Dry-run mode" {
        It "Downloads manifest in dry-run mode" {
            $env:DADABOT_DRY_RUN = "1"
            & "$InstallScript" -DryRun | Should -Match "latest-stable.json"
        }
        
        It "Uses beta channel with -Channel beta" {
            $env:DADABOT_CHANNEL = "beta"
            $env:DADABOT_DRY_RUN = "1"
            & "$InstallScript" -DryRun | Should -Match "latest-beta.json"
        }
        
        It "Uses nightly channel with -Channel nightly" {
            $env:DADABOT_CHANNEL = "nightly"
            $env:DADABOT_DRY_RUN = "1"
            & "$InstallScript" -DryRun | Should -Match "latest-nightly.json"
        }
        
        It "Rejects invalid channel" {
            $env:DADABOT_CHANNEL = "invalid"
            $env:DADABOT_DRY_RUN = "1"
            { & "$InstallScript" -DryRun } | Should -Throw
        }
    }
    
    Context "Platform detection" {
        It "Detects Windows x64" {
            $env:DADABOT_DRY_RUN = "1"
            & "$InstallScript" -DryRun | Should -Match "windows-x86_64"
        }
    }
    
    Context "Dry-run creates ~/.dadabot/bin" {
        It "Creates ~/.dadabot/bin in PATH" {
            $env:DADABOT_DRY_RUN = "1"
            & "$InstallScript" -DryRun | Should -Match "\.dadabot\\bin"
        }
    }
    
    Context "Channel switching" {
        It "Uses beta channel with -Channel beta" {
            $env:DADABOT_CHANNEL = "beta"
            $env:DADABOT_DRY_RUN = "1"
            & "$InstallScript" -DryRun | Should -Match "latest-beta.json"
        }
        
        It "Uses nightly channel with -Channel nightly" {
            $env:DADABOT_CHANNEL = "nightly"
            $env:DADABOT_DRY_RUN = "1"
            & "$InstallScript" -DryRun | Should -Match "latest-nightly.json"
        }
    }
}