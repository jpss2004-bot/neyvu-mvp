"""Run a single parser with bounded output, elapsed time and resident memory."""
import os,signal,subprocess,threading,time

def run_bounded(command,data,timeout=40,max_output=100000,memory_kib=512*1024):
    child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    def kill():
        try:os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    outputs=[bytearray(),bytearray()];overflow=threading.Event()
    def read(stream,dest):
        while True:
            chunk=stream.read(8192)
            if not chunk:break
            if len(dest)+len(chunk)>max_output:overflow.set();kill();break
            dest.extend(chunk)
        stream.close()
    def feed():
        try:child.stdin.write(data);child.stdin.close()
        except (BrokenPipeError,OSError):pass
    threads=[threading.Thread(target=read,args=(child.stdout,outputs[0])),threading.Thread(target=read,args=(child.stderr,outputs[1])),threading.Thread(target=feed)]
    for thread in threads:thread.start()
    deadline=time.monotonic()+timeout;failed=False
    try:
        while child.poll() is None:
            if time.monotonic()>deadline or overflow.is_set():failed=True;kill();break
            stat=subprocess.run(['/bin/ps','-axo','pid=,ppid=,rss='],capture_output=True,timeout=2)
            rows=[tuple(map(int,line.split())) for line in stat.stdout.splitlines()]
            descendants={child.pid}
            while True:
                expanded=descendants | {pid for pid,parent,rss in rows if parent in descendants}
                if expanded==descendants:break
                descendants=expanded
            rss=sum(rss for pid,parent,rss in rows if pid in descendants)
            # The process may start or exit between poll() and ps. An empty
            # sample is retried within the same wall-clock limit; it is not
            # evidence of excess memory or an unavailable parser.
            if child.poll() is None and (stat.returncode or rss>memory_kib):
                failed=True;kill();break
            time.sleep(.1)
        child.wait(timeout=3)
    finally:
        if child.poll() is None:kill();child.wait()
        kill()  # Terminate any parser descendants that outlived the direct child.
        for thread in threads:thread.join(timeout=3)
    if failed or overflow.is_set():raise ValueError('Parser exceeded its safe resource limit')
    return child.returncode,bytes(outputs[0]),bytes(outputs[1])
