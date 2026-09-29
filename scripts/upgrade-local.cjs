const {execFileSync}=require('node:child_process');const docker=process.env.DOCKER_BIN||'D:/Docker/Desktop/resources/bin/docker.exe';
function sql(q){return execFileSync(docker,['exec','-i','moxuany-mysql','sh','-c','exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --default-character-set=utf8mb4 moxuany'],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
if(!sql("SHOW COLUMNS FROM food_product LIKE 'version'"))sql('ALTER TABLE food_product ADD COLUMN version BIGINT NOT NULL DEFAULT 0');
for(const [name,type] of [['latitude','DECIMAL(9,6)'],['longitude','DECIMAL(10,6)']])if(!sql("SHOW COLUMNS FROM food_store LIKE '"+name+"'"))sql('ALTER TABLE food_store ADD COLUMN '+name+' '+type+' NULL');
if(!sql("SHOW INDEX FROM food_order WHERE Key_name='idx_order_member_filter'"))sql('ALTER TABLE food_order ADD INDEX idx_order_member_filter(member_id,type,status,created_at,id)');

for(const [table,name,type] of [
 ['food_store','open_time',"VARCHAR(5) NOT NULL DEFAULT ''"],['food_store','close_time',"VARCHAR(5) NOT NULL DEFAULT ''"],['food_store','delivery_radius','INT NOT NULL DEFAULT 0'],
 ['food_address','latitude','DECIMAL(9,6) NULL'],['food_address','longitude','DECIMAL(10,6) NULL']
])if(!sql("SHOW COLUMNS FROM "+table+" LIKE '"+name+"'"))sql('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);
for(const [table,name,cols] of [['food_product','idx_product_category','store_id,active,category,id'],['food_order','idx_order_alert','status,paid_at,id']])if(!sql("SHOW INDEX FROM "+table+" WHERE Key_name='"+name+"'"))sql('ALTER TABLE '+table+' ADD INDEX '+name+'('+cols+')');

sql(require('node:fs').readFileSync(require('node:path').join(__dirname,'../database/04-operations.sql'),'utf8'));
for(const [table,name,type] of [
 ['food_store','business_periods',"VARCHAR(200) NOT NULL DEFAULT ''"],['food_store','reservation_enabled','TINYINT NOT NULL DEFAULT 0'],['food_store','reservation_days','INT NOT NULL DEFAULT 3'],['food_store','lead_minutes','INT NOT NULL DEFAULT 30'],
 ['food_order','completed_at','DATETIME NULL'],['food_order','scheduled_at','DATETIME NULL'],['food_order','prepare_at','DATETIME NULL'],['food_order','refund_status',"VARCHAR(20) NOT NULL DEFAULT 'NONE'"],['food_order','refund_id','VARCHAR(40) NULL'],['food_order','expiry_retry_at','DATETIME NULL'],
 ['food_order_item','option_ids',"VARCHAR(300) NOT NULL DEFAULT ''"],['food_order_item','option_text',"VARCHAR(700) NOT NULL DEFAULT ''"]
])if(!sql("SHOW COLUMNS FROM "+table+" LIKE '"+name+"'"))sql('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);
if(!sql("SHOW INDEX FROM food_order WHERE Key_name='idx_order_refund'"))sql('ALTER TABLE food_order ADD INDEX idx_order_refund(store_id,refund_status,created_at,id)');
sql("UPDATE food_order SET completed_at=updated_at WHERE status='COMPLETED' AND completed_at IS NULL");
sql(require('node:fs').readFileSync(require('node:path').join(__dirname,'../database/05-delivery.sql'),'utf8'));
for(const [name,type] of [['rider_id','BIGINT NULL'],['rider_claimed_at','DATETIME NULL']])if(!sql("SHOW COLUMNS FROM food_order LIKE '"+name+"'"))sql('ALTER TABLE food_order ADD COLUMN '+name+' '+type);
if(!sql("SHOW INDEX FROM food_order WHERE Key_name='idx_order_rider'"))sql('ALTER TABLE food_order ADD INDEX idx_order_rider(rider_id,status,created_at,id)');
for(const [name,columns] of [['idx_order_report_day','created_at,store_id'],['idx_order_store_day','store_id,created_at']])if(!sql("SHOW INDEX FROM food_order WHERE Key_name='"+name+"'"))sql('ALTER TABLE food_order ADD INDEX '+name+'('+columns+')');
console.log('Local schema is current');
