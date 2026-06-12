import pandas as pd
path = r"C:\Users\lenovo\Desktop\Ss.xlsx"
print('PATH:', path)
xls = pd.ExcelFile(path)
print('SHEETS:', xls.sheet_names)
for sheet in xls.sheet_names:
    df = pd.read_excel(path, sheet_name=sheet)
    print(f"\n--- Sheet: {sheet} ---")
    print(df.head(20).to_string(index=False))
    print(f"[rows={len(df)}, cols={len(df.columns)}]")
