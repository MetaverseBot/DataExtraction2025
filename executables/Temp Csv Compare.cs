using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

internal static class Program
{
    private static void Main()
    {
        Console.Title = "Temp CSV Compare";
        Console.WriteLine("Temp CSV Compare");
        Console.WriteLine("Compares manual CSV vs generated CSV");
        Console.WriteLine();

        try
        {
            Console.Write("Manual CSV path: ");
            string manualPath = (Console.ReadLine() ?? "").Trim().Trim('"');
            Console.Write("Generated CSV path: ");
            string generatedPath = (Console.ReadLine() ?? "").Trim().Trim('"');

            if (!File.Exists(manualPath))
            {
                throw new Exception("Manual CSV file not found.");
            }

            if (!File.Exists(generatedPath))
            {
                throw new Exception("Generated CSV file not found.");
            }

            CsvData manual = LoadCsv(manualPath);
            CsvData generated = LoadCsv(generatedPath);

            Console.WriteLine();
            Console.WriteLine("Manual rows: " + manual.Rows.Count);
            Console.WriteLine("Generated rows: " + generated.Rows.Count);
            Console.WriteLine("Manual header: " + manual.Header);
            Console.WriteLine("Generated header: " + generated.Header);

            bool headerMatch = string.Equals(manual.Header, generated.Header, StringComparison.OrdinalIgnoreCase);
            Console.WriteLine("Header match: " + (headerMatch ? "YES" : "NO"));
            Console.WriteLine();

            Dictionary<string, int> manualCounts = ToCounts(manual.Rows);
            Dictionary<string, int> generatedCounts = ToCounts(generated.Rows);

            List<string> onlyInManual = new List<string>();
            List<string> onlyInGenerated = new List<string>();

            foreach (KeyValuePair<string, int> pair in manualCounts)
            {
                int generatedCount;
                generatedCounts.TryGetValue(pair.Key, out generatedCount);
                int delta = pair.Value - generatedCount;
                for (int i = 0; i < delta; i++)
                {
                    onlyInManual.Add(pair.Key);
                }
            }

            foreach (KeyValuePair<string, int> pair in generatedCounts)
            {
                int manualCount;
                manualCounts.TryGetValue(pair.Key, out manualCount);
                int delta = pair.Value - manualCount;
                for (int i = 0; i < delta; i++)
                {
                    onlyInGenerated.Add(pair.Key);
                }
            }

            onlyInManual.Sort(StringComparer.OrdinalIgnoreCase);
            onlyInGenerated.Sort(StringComparer.OrdinalIgnoreCase);

            Console.WriteLine("Rows missing from generated (present in manual): " + onlyInManual.Count);
            Console.WriteLine("Rows extra in generated (absent from manual): " + onlyInGenerated.Count);
            Console.WriteLine();

            PrintSample("Missing from generated", onlyInManual, 20);
            PrintSample("Extra in generated", onlyInGenerated, 20);

            string reportPath = Path.Combine(
                Path.GetDirectoryName(generatedPath) ?? Directory.GetCurrentDirectory(),
                "csv_compare_report_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".txt"
            );

            WriteReport(reportPath, manual, generated, headerMatch, onlyInManual, onlyInGenerated);
            Console.WriteLine("Full report: " + reportPath);

            bool exactMatch = headerMatch && onlyInManual.Count == 0 && onlyInGenerated.Count == 0;
            Console.WriteLine();
            Console.WriteLine(exactMatch ? "Result: MATCH" : "Result: DIFFERENT");
        }
        catch (Exception ex)
        {
            Console.WriteLine();
            Console.WriteLine("Error: " + ex.Message);
        }

        Console.WriteLine();
        Console.Write("Press Enter to close...");
        Console.ReadLine();
    }

    private static CsvData LoadCsv(string path)
    {
        List<string> lines = File.ReadAllLines(path)
            .Select(l => l.Trim())
            .Where(l => l.Length > 0)
            .ToList();

        if (lines.Count == 0)
        {
            throw new Exception("CSV is empty: " + path);
        }

        CsvData data = new CsvData();
        data.Header = lines[0];
        data.Rows = lines.Skip(1).ToList();
        return data;
    }

    private static Dictionary<string, int> ToCounts(List<string> rows)
    {
        Dictionary<string, int> counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (string row in rows)
        {
            int value;
            counts.TryGetValue(row, out value);
            counts[row] = value + 1;
        }
        return counts;
    }

    private static void PrintSample(string title, List<string> rows, int max)
    {
        Console.WriteLine(title + " (showing up to " + max + "):");
        if (rows.Count == 0)
        {
            Console.WriteLine("- none");
            Console.WriteLine();
            return;
        }

        int limit = Math.Min(max, rows.Count);
        for (int i = 0; i < limit; i++)
        {
            Console.WriteLine("- " + rows[i]);
        }
        Console.WriteLine();
    }

    private static void WriteReport(
        string reportPath,
        CsvData manual,
        CsvData generated,
        bool headerMatch,
        List<string> onlyInManual,
        List<string> onlyInGenerated)
    {
        List<string> lines = new List<string>();
        lines.Add("CSV Compare Report");
        lines.Add("Generated at: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        lines.Add("");
        lines.Add("Manual rows: " + manual.Rows.Count);
        lines.Add("Generated rows: " + generated.Rows.Count);
        lines.Add("Manual header: " + manual.Header);
        lines.Add("Generated header: " + generated.Header);
        lines.Add("Header match: " + (headerMatch ? "YES" : "NO"));
        lines.Add("Missing from generated: " + onlyInManual.Count);
        lines.Add("Extra in generated: " + onlyInGenerated.Count);
        lines.Add("");

        lines.Add("=== Missing from generated (manual only) ===");
        if (onlyInManual.Count == 0)
        {
            lines.Add("none");
        }
        else
        {
            lines.AddRange(onlyInManual);
        }
        lines.Add("");

        lines.Add("=== Extra in generated (generated only) ===");
        if (onlyInGenerated.Count == 0)
        {
            lines.Add("none");
        }
        else
        {
            lines.AddRange(onlyInGenerated);
        }

        File.WriteAllLines(reportPath, lines);
    }

    private sealed class CsvData
    {
        public string Header;
        public List<string> Rows;
    }
}
