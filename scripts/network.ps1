function Get-PhysicalPrivateIPv4 {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot
  )

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js es necesario para aplicar la clasificacion de red compartida.'
  }

  $Probe = "import { getMobileNetworkInfo } from './src/network.js'; console.log(JSON.stringify(getMobileNetworkInfo({ mobileBaseUrl: '' }).candidates));"
  Push-Location -LiteralPath $ProjectRoot
  try {
    $RawCandidates = @(& node --input-type=module -e $Probe)
    if ($LASTEXITCODE -ne 0) {
      throw 'No fue posible consultar la clasificacion de red de src/network.js.'
    }
  } finally {
    Pop-Location
  }

  $Json = ($RawCandidates -join [Environment]::NewLine).Trim()
  if (-not $Json) { return @() }

  $Candidates = $Json | ConvertFrom-Json
  return @(foreach ($Candidate in $Candidates) {
    [pscustomobject]@{
      InterfaceAlias = $Candidate.PSObject.Properties['interface'].Value
      IPAddress = $Candidate.PSObject.Properties['address'].Value
      Type = $Candidate.PSObject.Properties['type'].Value
      Selected = [bool]$Candidate.PSObject.Properties['selected'].Value
    }
  })
}
