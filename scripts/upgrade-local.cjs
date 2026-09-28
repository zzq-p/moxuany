const {execFileSync}=require('node:child_process');const docker=process.env.DOCKER_BIN||'D:/Docker/Desktop/resources/bin/docker.exe';
function sql(q){return execFileSync(docker,['exec','-i','moxuany-mysql','sh','-c','exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names moxuany'],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
if(!sql("SHOW COLUMNS FROM food_product LIKE 'version'"))sql('ALTER TABLE food_product ADD COLUMN version BIGINT NOT NULL DEFAULT 0');
for(const [name,type] of [['latitude','DECIMAL(9,6)'],['longitude','DECIMAL(10,6)']])if(!sql("SHOW COLUMNS FROM food_store LIKE '"+name+"'"))sql('ALTER TABLE food_store ADD COLUMN '+name+' '+type+' NULL');
if(!sql("SHOW INDEX FROM food_order WHERE Key_name='idx_order_member_filter'"))sql('ALTER TABLE food_order ADD INDEX idx_order_member_filter(member_id,type,status,created_at,id)');

for(const [table,name,type] of [
 ['food_store','open_time',"VARCHAR(5) NOT NULL DEFAULT ''"],['food_store','close_time',"VARCHAR(5) NOT NULL DEFAULT ''"],['food_store','delivery_radius','INT NOT NULL DEFAULT 0'],
 ['food_address','latitude','DECIMAL(9,6) NULL'],['food_address','longitude','DECIMAL(10,6) NULL']
])if(!sql("SHOW COLUMNS FROM "+table+" LIKE '"+name+"'"))sql('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);
for(const [table,name,cols] of [['food_product','idx_product_category','store_id,active,category,id'],['food_order','idx_order_alert','status,paid_at,id']])if(!sql("SHOW INDEX FROM "+table+" WHERE Key_name='"+name+"'"))sql('ALTER TABLE '+table+' ADD INDEX '+name+'('+cols+')');

console.log('Local schema is current');
