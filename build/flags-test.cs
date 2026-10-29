using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

class StartFlags
{
    [STAThread]
    static void Main(string[] args)
    {
        string exe = args[0];
        string flags = args.Length > 1 ? args[1] : "";
        string dir = Path.GetDirectoryName(exe);
        string logPath = Path.Combine(dir, "flags-test.log");
        var sb = new StringBuilder();
        sb.AppendLine("==== " + DateTime.Now.ToString("HH:mm:ss") + " flags=[" + flags + "] ====");
        try
        {
            var psi = new ProcessStartInfo(exe, ("--version " + flags).Trim());
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = dir;
            using (var p = Process.Start(psi))
            {
                string so = p.StandardOutput.ReadToEnd();
                string se = p.StandardError.ReadToEnd();
                bool exited = p.WaitForExit(12000);
                sb.AppendLine("version: exited=" + exited + " code=" + (exited ? ("0x" + p.ExitCode.ToString("X8")) : "timeout") + " out=" + (so.Length > 0 ? so.Trim() : "(空)") + " err=" + (se.Length > 0 ? se.Trim().Substring(0, Math.Min(200, se.Length)) : "(空)"));
                if (!exited) { try { p.Kill(); } catch { } }
            }
        }
        catch (Exception e) { sb.AppendLine("version 异常: " + e.Message); }

        try
        {
            var psi2 = new ProcessStartInfo(exe, flags);
            psi2.WorkingDirectory = dir;
            var p2 = Process.Start(psi2);
            if (p2 == null) sb.AppendLine("normal: null");
            else
            {
                System.Threading.Thread.Sleep(7000);
                p2.Refresh();
                sb.AppendLine("normal: " + (p2.HasExited ? ("exited code=0x" + p2.ExitCode.ToString("X8")) : ("alive pid=" + p2.Id)));
                if (!p2.HasExited) { try { p2.Kill(); } catch { } }
            }
        }
        catch (Exception e) { sb.AppendLine("normal 异常: " + e.Message); }

        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AITutorAssistant");
        sb.AppendLine("boot.log=" + File.Exists(Path.Combine(data, "boot.log")));
        File.AppendAllText(logPath, sb.ToString(), Encoding.UTF8);
    }
}
