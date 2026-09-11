const CONFIG = {
  SHEET_ID: '1NJxdiy7Jo1xQW6RnkYS5DINbr19GBVj9-xIih3kghvs',
  DRIVE_FOLDER_ID: '',
  SCHOOL_NAME: '嘉義市西區興嘉國民小學',
  SESSION_HOURS: 8,
  PASSWORD_MIN_LENGTH: 8
};

const HEADERS = {
  Users: ['username','passwordHash','salt','name','role','grade','active','mustChangePassword','updatedAt','lastLoginAt'],
  Sessions: ['tokenHash','username','createdAt','expiresAt'],
  Records: ['id','schoolYear','semester','grade','meetingNo','meetingDate','meetingTime','chair','recorder','location','attendees','agenda','discussion','status','attendanceFileId','attendanceUrl','createdBy','createdByName','createdAt','updatedBy','updatedByName','updatedAt'],
  Replies: ['recordId','academic','academicBy','academicAt','student_affairs','student_affairsBy','student_affairsAt','general_affairs','general_affairsBy','general_affairsAt','counseling','counselingBy','counselingAt','principal','principalBy','principalAt'],
  Photos: ['id','recordId','fileId','url','caption','sort','uploadedBy','uploadedAt'],
  AuditLog: ['timestamp','username','name','action','recordId','detail']
};

function doGet(){
  return json_({ok:true,service:'Sing Chia Grade Meeting API V2.1',time:now_()});
}

function doPost(e){
  try{
    const req=JSON.parse(e.postData && e.postData.contents || '{}');
    if(req.action==='login') return json_(Object.assign({ok:true},login_(req.username,req.password)));
    const user=verifySession_(req.token);
    let out;
    switch(req.action){
      case 'logout': logout_(req.token,user); out={loggedOut:true}; break;
      case 'changePassword': changePassword_(user,req.currentPassword,req.newPassword); out={changed:true,user:safeUser_(getUser_(user.username))}; break;
      case 'listRecords': out={records:listRecords_(user,req.filters||{})}; break;
      case 'getRecord': out={record:getRecordForUser_(user,req.id)}; break;
      case 'saveRecord': out={id:saveRecord_(user,req.record||{})}; break;
      case 'saveReply': saveReply_(user,req.recordId,req.department,req.text||''); out={saved:true}; break;
      case 'exportSinglePdf': out=exportSinglePdf_(user,req.id); break;
      case 'exportYearPdf': out=exportYearPdf_(user,req.filters||{}); break;
      case 'listUsers': requireAdmin_(user); out={users:listUsers_()}; break;
      case 'saveUser': requireAdmin_(user); out={user:saveUser_(user,req.user||{})}; break;
      case 'resetPassword': requireAdmin_(user); resetPassword_(user,req.username,req.newPassword); out={reset:true}; break;
      case 'setUserActive': requireAdmin_(user); setUserActive_(user,req.username,req.active); out={updated:true}; break;
      default: throw new Error('未知的操作');
    }
    return json_(Object.assign({ok:true},out||{}));
  }catch(err){
    return json_({ok:false,error:String(err && err.message || err)});
  }
}

function setupSystem(){
  const ss=SpreadsheetApp.openById(CONFIG.SHEET_ID);
  migrateOldUsersIfNeeded_(ss);
  Object.keys(HEADERS).forEach(name=>ensureSheet_(ss,name,HEADERS[name]));
  const props=PropertiesService.getScriptProperties();
  if(!CONFIG.DRIVE_FOLDER_ID && !props.getProperty('DRIVE_FOLDER_ID')){
    const folder=DriveApp.createFolder('興嘉國小-學年會議紀錄照片');
    props.setProperty('DRIVE_FOLDER_ID',folder.getId());
  }
  return '完成：已建立 Users / Sessions / Records / Replies / Photos / AuditLog。請再執行 createInitialAdmin() 建立初始管理者。';
}

function createInitialAdmin(){
  const users=sheet_('Users');
  if(users.getLastRow()>1) return 'Users 已有帳號，未建立預設管理者。';
  const username='admin';
  const password='ChangeMe@115';
  const salt=randomSalt_();
  appendObj_('Users',{username,passwordHash:hashPassword_(password,salt),salt,name:'系統管理者',role:'admin',grade:'',active:true,mustChangePassword:true,updatedAt:now_(),lastLoginAt:''});
  return '已建立初始帳號 admin，暫用密碼 ChangeMe@115。第一次登入會要求立即修改密碼。';
}

function migrateOldUsersIfNeeded_(ss){
  const sh=ss.getSheetByName('Users');
  if(!sh || sh.getLastColumn()===0) return;
  const heads=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
  if(heads.includes('email') && !heads.includes('username')){
    const stamp=Utilities.formatDate(new Date(),'Asia/Taipei','yyyyMMdd-HHmmss');
    sh.setName('Users_V2_Backup_'+stamp);
  }
}

function ensureSheet_(ss,name,headers){
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  if(sh.getMaxColumns()<headers.length) sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
  sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#eaf2fb');
  sh.setFrozenRows(1);
}

function login_(username,password){
  username=normalizeUsername_(username);
  if(!username || !password) throw new Error('請輸入帳號與密碼');
  const cache=CacheService.getScriptCache();
  const failKey='loginfail:'+username;
  const fails=Number(cache.get(failKey)||0);
  if(fails>=5) throw new Error('登入失敗次數過多，請 10 分鐘後再試或洽系統管理者');
  const row=getUser_(username);
  if(!row || !truthy_(row.active) || !constantTimeEqual_(hashPassword_(password,row.salt||''),String(row.passwordHash||''))){
    cache.put(failKey,String(fails+1),600);
    throw new Error('帳號或密碼錯誤');
  }
  cache.remove(failKey);
  cleanupSessions_();
  const rawToken=Utilities.getUuid()+Utilities.getUuid();
  const tokenHash=hashText_(rawToken);
  const created=new Date();
  const expires=new Date(created.getTime()+CONFIG.SESSION_HOURS*60*60*1000);
  appendObj_('Sessions',{tokenHash,username,createdAt:formatDateTime_(created),expiresAt:formatDateTime_(expires)});
  updateUserFields_(username,{lastLoginAt:now_()});
  const user=getUser_(username);
  audit_(user,'login','','');
  return {token:rawToken,user:safeUser_(user)};
}

function logout_(rawToken,user){
  const hash=hashText_(rawToken||'');
  deleteRowsByValue_('Sessions','tokenHash',hash);
  audit_(user,'logout','','');
}

function verifySession_(rawToken){
  if(!rawToken) throw new Error('登入已失效，請重新登入');
  const tokenHash=hashText_(rawToken);
  const session=findByKey_('Sessions','tokenHash',tokenHash);
  if(!session) throw new Error('登入已失效，請重新登入');
  const expires=parseDate_(session.expiresAt);
  if(!expires || expires.getTime()<=Date.now()){
    deleteRowsByValue_('Sessions','tokenHash',tokenHash);
    throw new Error('登入逾時，請重新登入');
  }
  const user=getUser_(session.username);
  if(!user || !truthy_(user.active)) throw new Error('此帳號已停用或不存在');
  return user;
}

function cleanupSessions_(){
  const sh=sheet_('Sessions');
  const data=sh.getDataRange().getValues();
  if(data.length<2) return;
  const heads=HEADERS.Sessions;
  const expIdx=heads.indexOf('expiresAt');
  for(let i=data.length-1;i>=1;i--){
    const d=parseDate_(data[i][expIdx]);
    if(!d || d.getTime()<=Date.now()) sh.deleteRow(i+1);
  }
}

function changePassword_(user,currentPassword,newPassword){
  if(!currentPassword || !constantTimeEqual_(hashPassword_(currentPassword,user.salt||''),String(user.passwordHash||''))) throw new Error('目前密碼不正確');
  validatePassword_(newPassword);
  const salt=randomSalt_();
  updateUserFields_(user.username,{passwordHash:hashPassword_(newPassword,salt),salt,mustChangePassword:false,updatedAt:now_()});
  audit_(user,'changePassword','','');
}

function listUsers_(){
  return rows_('Users').map(u=>({username:u.username,name:u.name,role:u.role,grade:String(u.grade||''),active:truthy_(u.active),mustChangePassword:truthy_(u.mustChangePassword),updatedAt:u.updatedAt,lastLoginAt:u.lastLoginAt})).sort((a,b)=>String(a.username).localeCompare(String(b.username)));
}

function saveUser_(admin,input){
  const username=normalizeUsername_(input.username);
  if(!username || !/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('帳號需為 3–40 字元，可使用英文小寫、數字、點、底線或連字號');
  const role=String(input.role||'teacher');
  const roles=['teacher','admin','academic','student_affairs','general_affairs','counseling','principal'];
  if(!roles.includes(role)) throw new Error('角色設定錯誤');
  const grade=role==='teacher'?String(input.grade||''):'';
  if(role==='teacher' && !['1','2','3','4','5','6'].includes(grade)) throw new Error('教師帳號請指定 1–6 年級');
  const existing=getUser_(username);
  const obj=existing?Object.assign({},existing):{username};
  obj.name=String(input.name||'').trim()||username;
  obj.role=role; obj.grade=grade; obj.active=input.active!==false; obj.updatedAt=now_();
  if(!existing){
    validatePassword_(input.password);
    obj.salt=randomSalt_(); obj.passwordHash=hashPassword_(input.password,obj.salt); obj.mustChangePassword=true; obj.lastLoginAt='';
  }else if(input.password){
    validatePassword_(input.password);
    obj.salt=randomSalt_(); obj.passwordHash=hashPassword_(input.password,obj.salt); obj.mustChangePassword=true;
  }
  upsert_('Users','username',username,obj);
  audit_(admin,existing?'updateUser':'createUser','',username+' / '+role+(grade?' / '+grade+'年級':''));
  return listUsers_().find(x=>x.username===username);
}

function resetPassword_(admin,username,newPassword){
  username=normalizeUsername_(username);
  const u=getUser_(username); if(!u) throw new Error('找不到帳號');
  validatePassword_(newPassword);
  const salt=randomSalt_();
  updateUserFields_(username,{passwordHash:hashPassword_(newPassword,salt),salt,mustChangePassword:true,updatedAt:now_()});
  deleteRowsByValue_('Sessions','username',username);
  audit_(admin,'resetPassword','',username);
}

function setUserActive_(admin,username,active){
  username=normalizeUsername_(username);
  if(username===admin.username && active===false) throw new Error('不能停用目前登入中的自己');
  const u=getUser_(username); if(!u) throw new Error('找不到帳號');
  updateUserFields_(username,{active:!!active,updatedAt:now_()});
  if(!active) deleteRowsByValue_('Sessions','username',username);
  audit_(admin,active?'enableUser':'disableUser','',username);
}

function getUser_(username){
  return findByKey_('Users','username',normalizeUsername_(username));
}
function updateUserFields_(username,fields){
  const u=getUser_(username); if(!u) throw new Error('找不到帳號');
  upsert_('Users','username',u.username,Object.assign({},u,fields));
}
function safeUser_(u){return {username:u.username,name:u.name,role:u.role,grade:String(u.grade||''),mustChangePassword:truthy_(u.mustChangePassword)};}
function requireAdmin_(u){if(u.role!=='admin') throw new Error('僅系統管理者可執行此操作');}
function canView_(u,r){return u.role!=='teacher' || String(r.grade)===String(u.grade);}
function canEdit_(u,r){return u.role==='admin' || (u.role==='teacher' && String(r.grade)===String(u.grade));}
function canReplyDept_(u,dept){const map={academic:'academic',student_affairs:'student_affairs',general_affairs:'general_affairs',counseling:'counseling',principal:'principal'};return u.role==='admin'||map[u.role]===dept;}

function listRecords_(u,f){
  return rows_('Records').filter(r=>canView_(u,r)).filter(r=>!f.schoolYear||String(r.schoolYear)===String(f.schoolYear)).filter(r=>!f.semester||String(r.semester)===String(f.semester)).filter(r=>!f.grade||String(r.grade)===String(f.grade)).sort((a,b)=>String(b.meetingDate).localeCompare(String(a.meetingDate))).map(r=>Object.assign({},r,{canEdit:canEdit_(u,r)}));
}
function getRecordForUser_(u,id){const r=findByKey_('Records','id',id);if(!r||!canView_(u,r))throw new Error('找不到紀錄或無權限');r.replies=getReplies_(id);r.photos=rows_('Photos').filter(p=>p.recordId===id).sort((a,b)=>Number(a.sort)-Number(b.sort));r.canEdit=canEdit_(u,r);return r;}

function saveRecord_(u,r){
  if(!r.schoolYear||!r.semester||!r.grade||!r.meetingNo||!r.meetingDate)throw new Error('必要欄位不完整');
  if(u.role==='teacher' && String(r.grade)!==String(u.grade))throw new Error('教師只能編修自己所屬學年的資料');
  let existing=r.id?findByKey_('Records','id',r.id):null;if(existing && !canEdit_(u,existing))throw new Error('無編修權限');
  const id=existing?existing.id:Utilities.getUuid();const ts=now_();
  let attendanceFileId=existing?existing.attendanceFileId:'';let attendanceUrl=existing?existing.attendanceUrl:'';
  if(r.attendanceImage){const f=saveUpload_(r.attendanceImage,'attendance-'+id);attendanceFileId=f.getId();attendanceUrl=fileUrl_(f.getId());}
  const obj={id,schoolYear:r.schoolYear,semester:r.semester,grade:r.grade,meetingNo:r.meetingNo,meetingDate:r.meetingDate,meetingTime:r.meetingTime||'',chair:r.chair||'',recorder:r.recorder||'',location:r.location||'',attendees:r.attendees||'',agenda:r.agenda||'',discussion:r.discussion||'',status:r.status==='submitted'?'submitted':'draft',attendanceFileId,attendanceUrl,createdBy:existing?existing.createdBy:u.username,createdByName:existing?existing.createdByName:u.name,createdAt:existing?existing.createdAt:ts,updatedBy:u.username,updatedByName:u.name,updatedAt:ts};
  upsert_('Records','id',id,obj);if(!findByKey_('Replies','recordId',id))upsert_('Replies','recordId',id,{recordId:id});
  (r.photos||[]).forEach(p=>{const f=saveUpload_(p,'meeting-'+id+'-'+(p.sort||''));appendObj_('Photos',{id:Utilities.getUuid(),recordId:id,fileId:f.getId(),url:fileUrl_(f.getId()),caption:p.caption||'',sort:p.sort||'',uploadedBy:u.username,uploadedAt:ts});});
  audit_(u,existing?'updateRecord':'createRecord',id,obj.status);return id;
}
function saveReply_(u,recordId,dept,text){if(!canReplyDept_(u,dept))throw new Error('無此處室回覆權限');const r=findByKey_('Records','id',recordId);if(!r||!canView_(u,r))throw new Error('找不到紀錄');const rep=findByKey_('Replies','recordId',recordId)||{recordId};rep[dept]=text;rep[dept+'By']=u.name;rep[dept+'At']=now_();upsert_('Replies','recordId',recordId,rep);audit_(u,'saveReply',recordId,dept);}
function getReplies_(id){const r=findByKey_('Replies','recordId',id)||{};return {academic:r.academic||'',student_affairs:r.student_affairs||'',general_affairs:r.general_affairs||'',counseling:r.counseling||'',principal:r.principal||''};}

function exportSinglePdf_(u,id){const r=getRecordForUser_(u,id);const blob=buildPdf_([r],`${r.schoolYear}學年度-${r.grade}年級-第${r.meetingNo}次學年會議紀錄`);return {fileName:blob.getName(),base64:Utilities.base64Encode(blob.getBytes())};}
function exportYearPdf_(u,f){if(!f.schoolYear||!f.grade)throw new Error('請指定學年度與學年');const recs=listRecords_(u,f).filter(r=>r.status==='submitted').map(r=>getRecordForUser_(u,r.id));if(!recs.length)throw new Error('沒有可匯出的已送出紀錄');const suffix=f.semester?`-第${f.semester}學期`:'';const blob=buildPdf_(recs,`${f.schoolYear}學年度-${f.grade}年級${suffix}-學年會議紀錄彙整`);return {fileName:blob.getName(),base64:Utilities.base64Encode(blob.getBytes())};}
function buildPdf_(records,name){
  const doc=DocumentApp.create(name+'-TEMP');const body=doc.getBody();body.clear();
  records.forEach((r,idx)=>{
    body.appendParagraph(CONFIG.SCHOOL_NAME).setHeading(DocumentApp.ParagraphHeading.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph(`${r.schoolYear}學年度 第${r.semester}學期 ${r.grade}年級 第${r.meetingNo}次學年會議記錄`).setHeading(DocumentApp.ParagraphHeading.HEADING2).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendTable([['時間',`${r.meetingDate} ${r.meetingTime}`,'主席',r.chair||''],['地點',r.location||'','會議記錄',r.recorder||''],['出席者',r.attendees||'','','']]).setBorderWidth(1);
    body.appendParagraph('報告事項與討論議題').setHeading(DocumentApp.ParagraphHeading.HEADING3);body.appendParagraph(r.agenda||'');
    body.appendParagraph('會議記錄／議題討論').setHeading(DocumentApp.ParagraphHeading.HEADING3);body.appendParagraph(r.discussion||'');
    body.appendParagraph('處室回覆').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendTable([['教務處',r.replies.academic||''],['學務處',r.replies.student_affairs||''],['總務處',r.replies.general_affairs||''],['輔導處',r.replies.counseling||''],['校長',r.replies.principal||'']]).setBorderWidth(1);
    if(r.attendanceFileId){body.appendParagraph('出席者簽到圖檔').setHeading(DocumentApp.ParagraphHeading.HEADING3);appendImageSafe_(body,r.attendanceFileId,480);}
    if((r.photos||[]).length){body.appendPageBreak();body.appendParagraph('學年會議記錄照片').setHeading(DocumentApp.ParagraphHeading.HEADING2).setAlignment(DocumentApp.HorizontalAlignment.CENTER);r.photos.forEach(p=>{appendImageSafe_(body,p.fileId,440);body.appendParagraph(p.caption||'照片說明').setAlignment(DocumentApp.HorizontalAlignment.CENTER);});}
    if(idx<records.length-1)body.appendPageBreak();
  });
  doc.saveAndClose();Utilities.sleep(500);const pdf=DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF).setName(name+'.pdf');DriveApp.getFileById(doc.getId()).setTrashed(true);return pdf;
}
function appendImageSafe_(body,fileId,maxWidth){try{const img=body.appendImage(DriveApp.getFileById(fileId).getBlob());const w=img.getWidth(),h=img.getHeight();if(w>maxWidth){img.setWidth(maxWidth);img.setHeight(Math.round(h*maxWidth/w));}}catch(e){body.appendParagraph('（圖片無法載入）');}}

function saveUpload_(obj,prefix){const bytes=Utilities.base64Decode(obj.base64);const blob=Utilities.newBlob(bytes,obj.mimeType||'application/octet-stream',sanitize_(prefix+'-'+(obj.name||'file')));return getUploadFolder_().createFile(blob);}
function getUploadFolder_(){const id=CONFIG.DRIVE_FOLDER_ID||PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');if(id)return DriveApp.getFolderById(id);const f=DriveApp.createFolder('興嘉國小-學年會議紀錄照片');PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID',f.getId());return f;}
function fileUrl_(id){return `https://drive.google.com/uc?export=view&id=${id}`;}
function sanitize_(s){return String(s).replace(/[\\/:*?"<>|]/g,'_');}
function normalizeUsername_(s){return String(s||'').trim().toLowerCase();}
function validatePassword_(p){if(!p || String(p).length<CONFIG.PASSWORD_MIN_LENGTH)throw new Error(`密碼至少 ${CONFIG.PASSWORD_MIN_LENGTH} 碼`);if(!/[A-Za-z]/.test(p)||!/[0-9]/.test(p))throw new Error('密碼至少需包含英文字母與數字');}
function randomSalt_(){return Utilities.getUuid().replace(/-/g,'');}
function hashPassword_(password,salt){return hashText_(String(salt)+'|'+String(password));}
function hashText_(text){const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text),Utilities.Charset.UTF_8);return bytes.map(b=>('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');}
function constantTimeEqual_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function formatDateTime_(d){return Utilities.formatDate(d,'Asia/Taipei','yyyy-MM-dd HH:mm:ss');}
function parseDate_(v){if(v instanceof Date)return v;const s=String(v||'').trim();if(!s)return null;const d=new Date(s.replace(' ','T')+'+08:00');return Number.isNaN(d.getTime())?null:d;}
function sheet_(name){return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(name)||(()=>{throw new Error('缺少工作表 '+name+'，請先執行 setupSystem()');})();}
function rows_(name){const sh=sheet_(name),last=sh.getLastRow();if(last<2)return [];const heads=HEADERS[name];return sh.getRange(2,1,last-1,heads.length).getValues().map(row=>Object.fromEntries(heads.map((h,i)=>[h,normalize_(row[i])])));}
function findByKey_(name,key,val){return rows_(name).find(r=>String(r[key]).toLowerCase()===String(val).toLowerCase())||null;}
function appendObj_(name,obj){const heads=HEADERS[name];sheet_(name).appendRow(heads.map(h=>obj[h]??''));}
function upsert_(name,key,val,obj){const sh=sheet_(name),heads=HEADERS[name],data=sh.getDataRange().getValues();let row=-1;const k=heads.indexOf(key);for(let i=1;i<data.length;i++)if(String(data[i][k]).toLowerCase()===String(val).toLowerCase()){row=i+1;break;}const values=heads.map(h=>obj[h]??'');if(row<0)sh.appendRow(values);else sh.getRange(row,1,1,heads.length).setValues([values]);}
function deleteRowsByValue_(name,key,val){const sh=sheet_(name),heads=HEADERS[name],k=heads.indexOf(key),data=sh.getDataRange().getValues();for(let i=data.length-1;i>=1;i--)if(String(data[i][k]).toLowerCase()===String(val).toLowerCase())sh.deleteRow(i+1);}
function audit_(u,action,recordId,detail){appendObj_('AuditLog',{timestamp:now_(),username:u.username,name:u.name,action,recordId,detail:detail||''});}
function normalize_(v){if(v instanceof Date)return Utilities.formatDate(v,Session.getScriptTimeZone()||'Asia/Taipei','yyyy-MM-dd HH:mm:ss');return v;}
function now_(){return Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');}
function truthy_(v){return v===true||String(v).toUpperCase()==='TRUE'||String(v)==='1';}
function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
