Add-Type -AssemblyName System.Drawing

function Resize-Image($srcPath, $destPath, $w, $h) {
    $srcImg = [System.Drawing.Image]::FromFile($srcPath)
    $destImg = New-Object System.Drawing.Bitmap($w, $h)
    $graphics = [System.Drawing.Graphics]::FromImage($destImg)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($srcImg, 0, 0, $w, $h)
    $destImg.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $destImg.Dispose()
    $srcImg.Dispose()
}

$src = (Resolve-Path 'public\rb-logo-new.png').Path
$res = (Resolve-Path 'android\app\src\main\res').Path

$map = @(
    @{ dir = 'mipmap-mdpi';    icon = 48;  fg = 108 },
    @{ dir = 'mipmap-hdpi';    icon = 72;  fg = 162 },
    @{ dir = 'mipmap-xhdpi';   icon = 96;  fg = 216 },
    @{ dir = 'mipmap-xxhdpi';  icon = 144; fg = 324 },
    @{ dir = 'mipmap-xxxhdpi'; icon = 192; fg = 432 }
)

foreach ($item in $map) {
    $target = Join-Path $res $item.dir
    Resize-Image $src (Join-Path $target 'ic_launcher.png') $item.icon $item.icon
    Resize-Image $src (Join-Path $target 'ic_launcher_round.png') $item.icon $item.icon
    Resize-Image $src (Join-Path $target 'ic_launcher_foreground.png') $item.fg $item.fg
    Write-Host "Updated $($item.dir)"
}
