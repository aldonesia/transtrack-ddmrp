import docx
doc = docx.Document('resources_ext/Blueprint(1).docx')
for para in doc.paragraphs:
    print(para.text)
