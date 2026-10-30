using System;
using System.IO;
using System.Windows.Forms;

class Probe
{
    [STAThread]
    static void Main()
    {
        string dir = Path.GetDirectoryName(Application.ExecutablePath);
        string log = Path.Combine(dir, "probe.log");
        try
        {
            File.AppendAllText(log, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " | probe ran | OS=" + Environment.OSVersion.VersionString + " | 64bit=" + Environment.Is64BitProcess + " | user=" + Environment.UserName + "\r\n");
        }
        catch { }
        MessageBox.Show(
            "如果你看到这个窗口，说明这台电脑可以正常运行「未签名」的程序。\n\n" +
            "那么 AI-Tutor-Assistant.exe 双击没反应，就是 Electron 运行时被安全软件（火绒）拦住了。\n\n" +
            "操作系统：" + Environment.OSVersion.VersionString + "\n" +
            "64 位进程：" + Environment.Is64BitProcess,
            "AI 课堂助手 · 运行环境探针",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }
}
