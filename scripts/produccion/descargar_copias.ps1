# Baja a este PC las copias de seguridad del servidor. Sin esto, si se pierde
# el servidor se pierden también las copias. Ejecútalo cada pocos días:
#
#   .\descargar_copias.ps1 -Servidor mitienda.duckdns.org -Clave C:\ruta\clave-oracle.key
param(
    [Parameter(Mandatory = $true)][string]$Servidor,
    [Parameter(Mandatory = $true)][string]$Clave,
    [string]$Usuario = "ubuntu",
    [string]$Destino = "$HOME\Documents\CopiasTienda"
)
$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $Destino | Out-Null
scp -i $Clave "${Usuario}@${Servidor}:/var/backups/tienda/*.sql.gz" $Destino
if ($LASTEXITCODE -ne 0) { throw "No se han podido descargar las copias." }

$ultima = Get-ChildItem $Destino -Filter "tienda_*.sql.gz" | Sort-Object Name | Select-Object -Last 1
Write-Output "Copias en $Destino. La más reciente: $($ultima.Name)"
