using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

class StartTest
{
    static string dir;
    static StringBuilder log = new StringBuilder();

    static void Write(string s)
    {
        log.AppendLine(s);
        Console.WriteLine(s);
        try { File.AppendAllText(Path.Combine(dir, "start-test.log"), s + "\r\n", Encoding.UTF8); } catch { }
    }

    [STAThread]
    static void Main(string[] args)
    {
        string target = args.Length > 0 ? args[0] : null;
        dir = target != null ? Path.GetDirectoryName(target) : Path.GetDirectoryName(Application.ExecutablePath);
        string exe = target ?? Path.Combine(dir, "AI-Tutor-Assistant.exe");
        Write("==== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " ====");
        Write("exe: " + exe + " (exists=" + File.Exists(exe) + ")");
        if (!File.Exists(exe)) { MessageBox.Show("找不到: " + exe, "启动测试"); return; }

        try
        {
            var psi = new ProcessStartInfo(exe, "--version");
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = dir;
            using (var p = Process.Start(psi))
            {
                string so = p.StandardOutput.ReadToEnd();
                string se = p.StandardError.ReadToEnd();
                bool exited = p.WaitForExit(15000);
                string code = exited ? ("0x" + p.ExitCode.ToString("X8")) : "timeout";
                Write("[--version] exited=" + exited + " exit=" + code + " out=" + (so.Length > 0 ? so.Trim() : "(空)") + " err=" + (se.Length > 0 ? se.Trim() : "(空)"));
                if (!exited) { try { p.Kill(); } catch { } }
            }
        }
        catch (Exception e) { Write("[--version] 异常: " + e.GetType().Name + ": " + e.Message); }

        string normal;
        try
        {
            var psi2 = new ProcessStartInfo(exe);
            psi2.UseShellExecute = true;
            psi2.WorkingDirectory = dir;
            var p2 = Process.Start(psi2);
            if (p2 == null) normal = "Process.Start 返回 null（被拦截）";
            else
            {
                Write("[normal] pid=" + p2.Id);
                System.Threading.Thread.Sleep(10000);
                p2.Refresh();
                normal = p2.HasExited ? ("进程已退出，退出码 0x" + p2.ExitCode.ToString("X8")) : ("进程仍在运行（pid=" + p2.Id + "）");
                Write("[normal] " + normal);
            }
        }
        catch (Exception e) { normal = "启动异常: " + e.Message; Write("[normal] " + normal); }

        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AITutorAssistant");
        Write("[logs] boot.log=" + File.Exists(Path.Combine(data, "boot.log")) + " startup.log=" + File.Exists(Path.Combine(data, "startup.log")));
        MessageBox.Show("目标：" + Path.GetFileName(exe) + "\r\n\r\n正常启动结果：" + normal + "\r\n\r\n详细见 start-test.log", "启动测试");
    }
}
