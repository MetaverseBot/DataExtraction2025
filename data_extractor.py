import backend
import os
import argparse

def load_pdf_files(directory):
  """
  Loads all PDF files within a given directory into a list.

  Args:
    directory: The path to the directory containing the PDF files.

  Returns:
    A list of strings, where each string is the full path to a PDF file.
  """

  pdf_files = []

  try:
    if os.path.isdir(directory):  # Check if the directory exists
      for filename in os.listdir(directory):
        if filename.endswith(".pdf"):
          pdf_files.append(os.path.join(directory, filename))
    else:
      print(f"Error: Directory '{directory}' does not exist.")
  except OSError as e:
    print(f"Error accessing directory: {e}")

  return pdf_files

def main():
  """
  Main function to parse arguments and load PDF files.
  """
  parser = argparse.ArgumentParser(description="Load PDF files from a directory.")
  parser.add_argument("input_path", help="Path to the directory containing PDF files.")
  args = parser.parse_args()
  print('args= ', args)

  files = load_pdf_files(args.input_path)
  # Extract data
  if files:
    print(files)
    combined_pdf_text = backend.combine_pdf_text(files)

    backend.data_extraction(combined_pdf_text)



print('hellow world!')
main()



