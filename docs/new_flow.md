what if we revise the flow, understand this:

1. user download file from system.
2. downloaded file is a zip folder containing more than 5 csv files.
3. extract the zip folder to make it file folder
4. each folder has a unique file name (e.g. to_2025-10-12_04-41-49.zip, take note that 10-12 is the date, 04-41-49 is the time downloaded) 
3. user upload or send that folder into google drive.
4. once uploaded into google drive, each csv files will sync and consolidate into google sheet note that each file has header names get only one, and before synching into google sheet, filter and columns to exclude must be implemented first before it will sync to google sheet.

here is the csv columns structure:
starting from column A1:AH (header name is in row 1)
A-TO Number
B-SPX Tracking Number
C-TO Status
D-High Value
E-Sender ID
F-Sender Name
G-Sender Type
H-Sender Station Type
I-Receiver ID
J-Receiver Name
K-Receiver type
L-Receiver Station Type 
M-Current Station
N-TO Order Quantity
O-TO Direction
P-Volumetric Weight
Q-Weight
R-Length
S-Width
T-Height
U-Line Hual Trip Number
V-Operator
W-Create Time
X-Complete Time
Y-Driver
Z-Driver Scan Time
AA-Journey Type
AB-Remark
AC-Receive Status
AD-TO Remark
AE-Staging Area ID
AF-Exception Tag
AG-Packing Method	
AH-Dangerous Goods

before synching into google sheet: 
1. Remove duplicate value in col A (TO Number) and its corresponding row data. 
2. Filter: (only this value and its corresponding row data will be kept)
    - is "Station" in col K (Receiver type)
    - is "SOC 5" in col M (Current Station)
    - is "Pending Receive" in col AC (Receive Status)
3. This are only the columns to sync:
    - A-TO Number
    - B-SPX Tracking Number
    - J-Receiver Name
    - N-TO Order Quantity
    - V-Operator
    - W-Create Time
    - X-Complete Time

Once done, it will now be synced to google sheet.
Then dashboard in tab "Backlogs Summary" in sheet: 17cvCc6ffMXNs6JYnpMYvDO_V8nBCRKRm3G78oINj_yo will update automatically.
the capture image in sheet: 1J8TCeiYjpDtXmOcjPbPcx92FPIG69S3MuH_ZqkcqE8U tab: "Backlogs Summary" range: B2:R67


drive_id: 1oU9kj5VIJIoNrR388wYCHSdtHGanRrgZ
sync sheet_id: 17cvCc6ffMXNs6JYnpMYvDO_V8nBCRKRm3G78oINj_yo
tab_name: [FWD] OB SOC_Packed Generated Data
start cell range: A2 (when this change this will start trigger)

sheet_id to capture image: 1J8TCeiYjpDtXmOcjPbPcx92FPIG69S3MuH_ZqkcqE8U
tab name: Backlogs Summary
range to capture: B2:R67