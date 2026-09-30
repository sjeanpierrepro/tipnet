# Regenerates PNG icons from the same geometry as icon.svg. Run from tools/: powershell -File make-icons.ps1
Add-Type -AssemblyName System.Drawing
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'app' 'icons'
function Make($size, $scale, $name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#121417'))
  $k = $size / 512.0
  $pts = @(@(96,112),@(416,112),@(416,192),@(296,192),@(296,400),@(216,400),@(216,192),@(96,192))
  $poly = foreach ($p in $pts) {
    $x = (256 + ($p[0]-256)*$scale) * $k; $y = (256 + ($p[1]-256)*$scale) * $k
    New-Object System.Drawing.PointF ([single]$x), ([single]$y)
  }
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#C9A45C'))
  $g.FillPolygon($brush, [System.Drawing.PointF[]]$poly)
  $g.Dispose()
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Make 192 1.0 'icon-192.png'
Make 512 1.0 'icon-512.png'
Make 512 0.8 'maskable-512.png'
Make 180 1.0 'apple-touch-icon.png'
Make 32 1.0 'favicon-32.png'
