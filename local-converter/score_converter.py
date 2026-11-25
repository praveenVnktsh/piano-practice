from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,uuid,subprocess,os,zipfile,xml.etree.ElementTree as ET,threading
BASE=Path(__file__).resolve().parent
ENGINE=BASE/'audiveris-src/app/build/install/app/bin/Audiveris'
ALLOWED={'https://una-mattina-measure-37.spiffybuffalo6.chatgpt.site','http://localhost:8879','http://127.0.0.1:8879'}
JOBS={};LOCK=threading.Lock();POOL=ThreadPoolExecutor(max_workers=1)
def recognize(job_id):
 job=JOBS[job_id];folder=BASE/'converter-jobs'/job_id;env=dict(os.environ,JAVA_HOME='/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home',TESSDATA_PREFIX=str(BASE/'tessdata'));cmd=[str(ENGINE),'-batch','-transcribe','-export','-output',str(folder),'--',str(folder/'score.pdf')]
 try:
  job['status']='processing'
  with (folder/'recognition.log').open('w') as log:result=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600)
  partial=result.returncode!=0
  if not list(folder.glob('*.mxl')):
   projects=list(folder.glob('*.omr'))
   if not projects:raise ValueError('No score recognized. Check that the PDF has clear printed notation.')
   with (folder/'recognition.log').open('a') as log:subprocess.run([str(ENGINE),'-batch','-export','--',str(projects[0])],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=120)
  files=list(folder.glob('*.mxl'))
  if not files:raise ValueError('No MusicXML was exported. The PDF needs manual repair in Audiveris or a notation editor.')
  if len(files)>1:raise ValueError('Several independent scores were found. Export and import the desired score as MusicXML.')
  with zipfile.ZipFile(files[0]) as z:
   container=ET.fromstring(z.read('META-INF/container.xml'));name=container.find('.//{*}rootfile').get('full-path');xml=z.read(name).decode('utf-8')
  job.update(status='complete',xml=xml,partial=partial,warning='Some pages or systems may be missing; recognition was incomplete.' if partial else 'Recognition is an unverified draft. Compare every selected passage with the PDF.')
 except subprocess.TimeoutExpired:job.update(status='failed',error='Recognition exceeded 10 minutes. Try a smaller passage or a clearer PDF.')
 except Exception as e:job.update(status='failed',error=str(e))
class Handler(BaseHTTPRequestHandler):
 def valid(self):return self.headers.get('Origin','') in ALLOWED|{''} and self.headers.get('Host','').split(':')[0] in {'127.0.0.1','localhost'}
 def headers_cors(self):
  origin=self.headers.get('Origin','')
  if origin in ALLOWED:self.send_header('Access-Control-Allow-Origin',origin)
  self.send_header('Vary','Origin');self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type, X-Score-Request');self.send_header('Access-Control-Allow-Private-Network','true');self.send_header('Cache-Control','no-store')
 def respond(self,code,value):
  payload=json.dumps(value).encode();self.send_response(code);self.headers_cors();self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
 def do_OPTIONS(self):
  if not self.valid():return self.respond(403,{'error':'Origin not allowed'})
  self.send_response(204);self.headers_cors();self.end_headers()
 def do_GET(self):
  if not self.valid():return self.respond(403,{'error':'Origin not allowed'})
  if self.path=='/health':return self.respond(200,{'engine':'Audiveris 5.11.0','ready':ENGINE.exists()})
  job_id=self.path.removeprefix('/jobs/');job=JOBS.get(job_id)
  if not job:return self.respond(404,{'error':'Job not found'})
  self.respond(200,job)
 def do_POST(self):
  if not self.valid() or self.headers.get('X-Score-Request')!='1':return self.respond(403,{'error':'Request not allowed'})
  if self.path!='/jobs':return self.respond(404,{'error':'Not found'})
  length=int(self.headers.get('Content-Length','0'))
  if not 1<=length<=50*1024*1024:return self.respond(413,{'error':'Choose a PDF smaller than 50 MB'})
  if not ENGINE.exists():return self.respond(503,{'error':'Audiveris engine is not installed'})
  data=self.rfile.read(length)
  if not data.startswith(b'%PDF-'):return self.respond(400,{'error':'This is not a PDF file'})
  with LOCK:
   if sum(j['status'] in {'queued','processing'} for j in JOBS.values())>=2:return self.respond(429,{'error':'Recognition is busy. Wait for the current job.'})
   job_id=str(uuid.uuid4());folder=BASE/'converter-jobs'/job_id;folder.mkdir(parents=True);(folder/'score.pdf').write_bytes(data);JOBS[job_id]={'id':job_id,'status':'queued'}
  POOL.submit(recognize,job_id);self.respond(202,{'id':job_id})
if __name__=='__main__':
 print('Local score recognition: http://127.0.0.1:8937 (keep this window open)',flush=True);ThreadingHTTPServer(('127.0.0.1',8937),Handler).serve_forever()
