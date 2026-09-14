$path = Join-Path $env:USERPROFILE "Downloads\забытые_смены_июль_август_2026.xlsx"
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($path)
$excel.CalculateFull()
$ws = $wb.Worksheets.Item("Сводка")
$b5 = $ws.Range("B5").Value2
$b6 = $ws.Range("B6").Value2
$b7 = $ws.Range("B7").Value2
$b8 = $ws.Range("B8").Value2
$wb.Save()
$wb.Close($true)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
Write-Output "B5=$b5 B6=$b6 B7=$b7 B8=$b8"
