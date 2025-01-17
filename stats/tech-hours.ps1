$response = Invoke-RestMethod "http://localhost:3000/api/schedule?start=2025-01-06T05:00:00.000Z&end=2025-01-07T05:00:00.000Z"
$response.scheduledServices | Group-Object techId | ForEach-Object { $first = $_.Group[0]; $last = $_.Group[-1]
@{ tech = $first.techId
services = $_.Count
duration = [math]::Round(([datetime]$last.end - [datetime]$first.start).TotalHours, 2) } } | Sort-Object duration | ConvertTo-Json
