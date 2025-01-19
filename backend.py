import re
import zipfile
from urllib import response

import PyPDF2
from fpdf import FPDF
import requests

names_and_emails = [
    ["Chaofang Jin", "chaofangjin@example.com"],
    ["Huijuan Ji", "huijuanji@example.com"],
    ["Jing Xu", "jingxu@example.com"],
    ["Hong Sun", "hongsun@example.com"],
    ["Qinying Lei", "qinyinglei@example.com"],
    ["Baohu Ji", "baohuji@example.com"],
    ["Wenjing Yin", "wenjingyin@example.com"],
    ["Lihpang Lu", "lihpanglu@example.com"],
    ["Wei Wu", "weiwu@example.com"],
    ["Jun Hu", "junhu@example.com"],
    ["Fan Fei", "fanfei@example.com"],
    ["Qingqing Yang", "qingqingyang@example.com"],
    ["Xiao Guan", "xiaoguan@example.com"],
    ["Li Li", "lili@example.com"],
    ["Jingjing Zhang", "jingjingzhang@example.com"],
    ["Qingzhen Guo", "qingzhenguo@example.com"],
    ["Sung Ko", "sungko@example.com"],
    ["Yanru Li", "yanruli@example.com"],
    ["Yu Li", "yuli@example.com"],
    ["Ling Wang", "lingwang@example.com"],
    ["Xin Xu", "xinxu@example.com"],
    ["Yanru Yang", "yanruyang@example.com"],
    ["Honghao Shan", "honghaoshan@example.com"],
    ["Aijie Han", "aijiehan@example.com"],
    ["Tao Liu", "taoliu@example.com"],
    ["Wei Wu", "weiwu@example.com"],
    ["Linghan Gao", "linghangao@example.com"],
    ["Yan Wang", "yanwang@example.com"],
    ["Changyi Zhao", "changyizhao@example.com"],
    ["Jing Wu", "jingwu@example.com"],
    ["Haiyun Zhou", "haiyunzhou@example.com"],
    ["Jun Hu", "junhu@example.com"],
    ["Ortal Zeevi", "ortalzeevi@example.com"],
    ["Bo Zhuang", "bozhuang@example.com"],
    ["Yu Shi", "yushi@example.com"],
    ["David Yin", "davidyin@example.com"],
    ["Ling Wang", "lingwang@example.com"],
    ["Min Li", "minli@example.com"],
    ["Aurora Xiaoyao Liu", "auroraxiaoyaoliu@example.com"],
    ["Jiacong Li", "jiacongli@example.com"],
    ["Qiao Shen", "qiaoshen@example.com"],
    ["Liang MA", "liangma@example.com"],
    ["Yuping He", "yupinghe@example.com"],
    ["Yongmei Xu", "yongmeixu@example.com"],
    ["Hsiu Lee", "hisulee@example.com"],
    ["Ruoyu Zhang", "ruoyuzhang@example.com"],
    ["Huijuan Ji", "huijuanji@example.com"]
]


def generate_pdf(name, list):
    """
    This function generates a thank you letter PDF using the provided name.

    Args:
    name: The name to be used in the thank you letter.
    """
    # Create an FPDF object
    pdf = FPDF()
    pdf.add_page()

    pdf.image(r"C:\Users\charl\PycharmProjects\DataExtraction2025\Untitled.jpg", x=165, y=10, w=30, h=0)

    # Set font and title
    pdf.set_font("Helvetica", size=14)
    pdf.cell(0, 10, txt="Asian American Parent Alliance of San Diego", ln=1)

    # Set contact information
    pdf.set_font("Helvetica", size=10)
    pdf.cell(0, 6, txt="4653 Carmel Mountain Rd, # 308-220", ln=1)
    pdf.cell(0, 6, txt="San Diego, CA 92130", ln=1)
    pdf.set_text_color(0, 0, 255)
    pdf.set_font("Helvetica", size=10, style="U")
    pdf.cell(0, 6, txt="www.AAPASD.org Email: info@AAPASD.org", ln=1)

    # Set date
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", size=12)
    pdf.cell(0, 12, txt="12/5/2023", ln=1)

    # Set body text
    for line in [
        f"Dear {name},", "\n",
        "On behalf of the Asian American Parent Alliance of San Diego (AAPASD), we would like to thank",
        "you very much for your support to AAPASD. Your care for the education of the youths will",
        "certainly have a great positive impact on their lives and on the future of our community.",
        "\n",
        "Fostering Asian American community participation and providing a platform to advocate for-",
        "merit-based education in San Diego County are the missions we are devoted to. Without your",
        "continuing support, we can never achieve these noble goals. Your support is the foundation of",
        "our organization.", "\n",
        "If you have any questions about your donation or suggestion about how to improve this",
        "organization, please contact us based on the information provided above. If you wish to work",
        "with us as a volunteer, also kindly let us know.", "\n"
                                                            "Thank you again for your confidence and generosity!", "\n",
        "Sincerely,", "\n", "\n", "Team AAPASD", "Accounting@AAPASD.org",
        "\n"
    ]:
        if line == "Accounting@AAPASD.org":
            pdf.set_text_color(0, 0, 255)
            pdf.set_font("Helvetica", style="U")
        pdf.multi_cell(0, 6, txt=line)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica")

    # Header row
    pdf.set_font("Helvetica", size=12, style="B")
    pdf.cell(30, 6, txt="Record ID", border=1)
    pdf.cell(40, 6, txt="Contribution Date", border=1)
    pdf.cell(30, 6, txt="Amount", border=1)
    pdf.cell(50, 6, txt="Sponsor(s)", border=1)
    pdf.cell(30, 6, txt="Payment Type", border=1)
    pdf.ln(6)  # Move to the next line

    data = []

    for item in list:
        if item[0] == name:
            sort_list = []
            sort_list.append("####")
            sort_list.append(item[1])
            sort_list.append(item[2])
            sort_list.append(item[0])
            sort_list.append(item[3])
            data.append(sort_list)

    # Data rows
    pdf.set_font("Helvetica", size=12)
    for row in data:
        pdf.cell(30, 6, txt=row[0], border=1)
        pdf.cell(40, 6, txt=row[1], border=1)
        pdf.cell(30, 6, txt=row[2], border=1)
        pdf.cell(50, 6, txt=row[3], border=1)
        pdf.cell(30, 6, txt=row[4], border=1)
        pdf.ln(6)  # Move to the next line

    # Set footer
    pdf.set_y(-55)  # Move to the bottom of the page
    pdf.set_font("Helvetica", size=12)
    footer_text = [
        "\n",
        "Contributions to AAPASD, a non-profit 501(c)(3) charitable organization effective 02/17/2023, are tax",
        "deductible to the extent provided by law. Please retain this letter as receipt of your donation. In",
        "accordance with IRS regulations, no goods or services were provided to the donor by AAPASD in",
        "consideration of this contribution. Our Tax ID Number is 88-2564739",
    ]
    for line in footer_text:
        pdf.cell(0, 6, txt=line, ln=1)

    # Output the PDF
    pdf.output(rf"C:\Users\charl\PycharmProjects\DataExtraction2025\Output\Thank_You_Letter_{name}.pdf")  # Save the PDF
    return pdf


def download_all_files(pdf_data_list):
    with zipfile.ZipFile('all_files.zip', 'w') as zipf:
        for name, pdf_data in pdf_data_list:
            zipf.writestr(f"{name}.pdf", pdf_data.output(dest='S').encode('latin-1'))
    with open('all_files.zip', 'rb') as f:
        return f.read()


def data_extraction(text):
    text_into_lines = text.splitlines()
    payment_lines = [line for line in text_into_lines if "Payment From" in line]

    if not payment_lines:
        print("No payment lines found in the PDF.")
        return

    data = [["Name", "Date", "Amount", "Form of donation", "Email"]]

    for line in payment_lines:  # For every line that is needed,

        line = line.strip()

        match = re.match(r'.*(\d{2}/\d{2})\s+(\w+\s+\w+)\s+\w+\s+(\w+\s+\w+\s?\w+?)\s+\w+\s+([0-9$]+\.\d{2})', line)

        if match:
            date, form, name, amount = match.groups()
            email = "Not Found"
            for group in names_and_emails:
                if group[0] == name:
                    email = group[1]
            data.append([name, date, amount, form, email])
        else:
            print("Invalid line format: " + line)

    print(data)

    pdf_data_list = []

    for name, data_list in group_data_by_name(data):
        pdf_data = generate_pdf(name, data_list)
        pdf_data_list.append((name, pdf_data))
        # st.download_button(name + ": Download", pdf_data.output(dest='S').encode('latin-1'), file_name=f"{name}.pdf")
        # with open(rf"C:\Users\charl\PycharmProjects\DataExtraction2025\Output\Thank_You_Letter_{name}.pdf", 'rb') as f:
        #     data = f.read()

    # st.download_button("Download All", download_all_files(pdf_data_list), file_name="all_files.zip")

    # st.balloons()


def group_data_by_name(data):
    grouped_data = {}
    for row in data[1:]:  # Skip header row
        name = row[0]
        if name not in grouped_data:
            grouped_data[name] = []
        grouped_data[name].append(row)
    return grouped_data.items()


def combine_pdf_text(uploaded_files):
    """
    Combines text from all pages of uploaded PDF files into a single string.

    Args:
        uploaded_files (list): List of uploaded files from Streamlit.

    Returns:
        str: Combined text content from all PDFs.
    """
    all_text = ""
    for uploaded_file in uploaded_files:
        try:
            # Use PyPDF2 to read the PDF content
            reader = PyPDF2.PdfReader(uploaded_file)
            # Extract text from each page and append
            for page_num in range(len(reader.pages)):
                page = reader.pages[page_num]
                all_text += page.extract_text()
        except FileNotFoundError:
            print(f"File not found: {uploaded_file.name}")
        except Exception as e:
            print(f"Error processing file {uploaded_file.name}: {e}")
    return all_text
