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
        try { File.AppendAllText(Path.Combine(dir, "start-test.log"), s + "\r\n", Encoding.UTF8); } catch { }
    }

    [STAThread]
    static void Main()
    {
        dir = Path.GetDirectoryName(Application.ExecutablePath);
        string exe = Path.Combine(dir, "AI-Tutor-Assistant.exe");
        Write("==== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " ====");
        Write("exe: " + exe);
        Write("exists: " + File.Exists(exe));
        if (!File.Exists(exe))
        {
            MessageBox.Show("找不到 AI-Tutor-Assistant.exe", "启动测试");
            return;
        }

        // 1) 版本探测（捕获 stdout/stderr 与退出码）
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
                string code = exited ? ("0x" + p.ExitCode.ToString("X8") + " (" + p.ExitCode + ")") : "未退出(超时)";
                Write("[--version] exited=" + exited + " exit=" + code);
                Write("[--version] stdout=" + (so.Length > 0 ? so.Trim() : "(空)"));
                Write("[--version] stderr=" + (se.Length > 0 ? se.Trim() : "(空)"));
                if (!exited) { try { p.Kill(); } catch { } }
            }
        }
        catch (Exception e)
        {
            Write("[--version] 启动异常: " + e.GetType().Name + ": " + e.Message);
        }

        // 2) 正常启动
        string normal = "";
        try
        {
            var psi2 = new ProcessStartInfo(exe);
            psi2.UseShellExecute = true;
            psi2.WorkingDirectory = dir;
            var p2 = Process.Start(psi2);
            if (p2 == null)
            {
                normal = "Process.Start 返回 null（被系统/安全软件拦截）";
            }
            else
            {
                Write("[normal] pid=" + p2.Id);
                System.Threading.Thread.Sleep(9000);
                p2.Refresh();
                if (p2.HasExited)
                {
                    normal = "进程已退出，退出码 0x" + p2.ExitCode.ToString("X8") + " (" + p2.ExitCode + ")";
                }
                else
                {
                    normal = "进程仍在运行（pid=" + p2.Id + "，窗口可能已显示）";
                }
                Write("[normal] " + normal);
            }
        }
        catch (Exception e)
        {
            normal = "启动异常: " + e.GetType().Name + ": " + e.Message;
            Write("[normal] " + normal);
        }

        // 3) 日志文件是否生成
        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AITutorAssistant");
        Write("[logs] boot.log 存在: " + File.Exists(Path.Combine(data, "boot.log")));
        Write("[logs] startup.log 存在: " + File.Exists(Path.Combine(data, "startup.log")));

        string summary = "版本探测结果：\r\n" + GetLast(2) + "\r\n正常启动结果：\r\n" + normal +
                         "\r\n\r\n详细日志已写入 start-test.log，请把它发给开发者。";
        MessageBox.Show(summary, "AI 课堂助手 · 启动测试", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static string GetLast(int n)
    {
        string[] lines = log.ToString().Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
        var sb = new StringBuilder();
        for (int i = Math.Max(0, lines.Length - n); i < lines.Length; i++) sb.AppendLine(lines[i]);
        return sb.ToString();
    }
}
