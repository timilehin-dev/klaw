# Skill: Text Processing & OCR
**Trigger:** User provides documents, text logs, or asks to extract text from images.
**Action:**
1. Write a Python script using `Pillow` + `pytesseract` (OCR), `PyMuPDF`/`pdfplumber` (PDFs), or regex (logs).
2. Process the input file (stage inputs via sandbox `files` when available).
3. Save extracted text to `/mnt/data/extracted.txt`.
4. Call `execute_code` to run the script.
