# crop_paper.ps1 -- auto-locate the A4 paper (.page-size) inside a full designer
# screenshot and crop it out. ASCII only (Windows PowerShell reads .ps1 as GBK).
# usage: & .\crop_paper.ps1 -In <full.png> -Out <paper.png>
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Bitmap]::FromFile((Resolve-Path $In).Path)
$W = $img.Width; $H = $img.Height
Write-Output "full screenshot: $W x $H"

function Test-White($c) { return ($c.R -gt 244 -and $c.G -gt 244 -and $c.B -gt 244) }
# designer canvas backdrop is light blue #E3EBF6 (227,235,246); side panels are pure white
function Test-Canvas($c) { return ([Math]::Abs($c.R - 227) -le 6 -and [Math]::Abs($c.G - 235) -le 6 -and [Math]::Abs($c.B - 246) -le 6) }

$yProbe = [int]($H * 0.45)

# canvas band = first..last backdrop-coloured pixel on that line (paper in the middle is NOT backdrop, which is fine)
$canvasL = -1; $canvasR = -1
for ($x = 0; $x -lt $W; $x++) {
  $c = $img.GetPixel($x, $yProbe)
  if (Test-Canvas $c) { if ($canvasL -lt 0) { $canvasL = $x }; $canvasR = $x }
}
if ($canvasL -lt 0) { Write-Output "canvas backdrop not found"; $img.Dispose(); exit 1 }
Write-Output "canvas backdrop x: $canvasL .. $canvasR"

# paper edges = first/last NON-backdrop pixel inside the canvas band
$left = -1; $right = -1
for ($x = $canvasL; $x -le $canvasR; $x++) {
  if (-not (Test-Canvas $img.GetPixel($x, $yProbe))) { $left = $x; break }
}
for ($x = $canvasR; $x -ge $canvasL; $x--) {
  if (-not (Test-Canvas $img.GetPixel($x, $yProbe))) { $right = $x; break }
}
if ($left -lt 0 -or $right -le $left) { Write-Output "paper not found inside canvas band"; $img.Dispose(); exit 1 }
Write-Output "paper left/right: $left .. $right  (w=$($right - $left + 1))"

# top/bottom: same rule on the paper centre column (canvas band vertically first, to skip the toolbar)
$cx = [int](($left + $right) / 2)
$canvasT = -1; $canvasB = -1
for ($yy = 0; $yy -lt $H; $yy++) {
  if (Test-Canvas $img.GetPixel($cx, $yy)) { if ($canvasT -lt 0) { $canvasT = $yy }; $canvasB = $yy }
}
if ($canvasT -lt 0) { Write-Output "canvas backdrop not found vertically"; $img.Dispose(); exit 1 }
$top = -1; $bottom = -1
for ($yy = $canvasT; $yy -le $canvasB; $yy++) {
  if (-not (Test-Canvas $img.GetPixel($cx, $yy))) { $top = $yy; break }
}
for ($yy = $canvasB; $yy -ge $canvasT; $yy--) {
  if (-not (Test-Canvas $img.GetPixel($cx, $yy))) { $bottom = $yy; break }
}
if ($top -lt 0 -or $bottom -le $top) { Write-Output "paper not found on centre column"; $img.Dispose(); exit 1 }
Write-Output "paper top/bottom: $top .. $bottom  (h=$($bottom - $top + 1))"

$rx = [Math]::Max(0, $left - 1); $ry = [Math]::Max(0, $top - 1)
$rw = [Math]::Min($W - $rx, ($right - $left + 3)); $rh = [Math]::Min($H - $ry, ($bottom - $top + 3))
Write-Output ("crop: ({0},{1}) {2}x{3}  ratio={4} (A4 = 0.707)" -f $rx, $ry, $rw, $rh, [Math]::Round($rw / $rh, 3))

$bmp = New-Object System.Drawing.Bitmap($rw, $rh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $rw, $rh)), (New-Object System.Drawing.Rectangle($rx, $ry, $rw, $rh)), [System.Drawing.GraphicsUnit]::Pixel)
$bmp.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()
Write-Output "saved: $Out"
