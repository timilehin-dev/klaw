# Skill: Document Generation
**Trigger:** User asks to create a PDF, DOCX, XLSX, or CSV.
**Action:**
1. Extract the required data and structure.
2. Write a Python script using `reportlab` (for PDF) or `openpyxl` (for XLSX) or `python-docx` / `csv`.
3. The script MUST save the file under `/mnt/data/` (sandbox workspace), e.g. `/mnt/data/output.pdf`.
4. Call `execute_code` to run the script.
5. Tell the user the relative path (e.g. `output.pdf`) that was generated.
