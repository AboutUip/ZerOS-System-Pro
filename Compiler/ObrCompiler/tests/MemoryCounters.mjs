/** 测试用逻辑访存分类：直接/间接助记符必须计入同一口径，独立于主板物理请求。 */
export function memoryCounter(){return {loads:0,stores:0};}
export function noteMemoryAccess(counter,operation){
 if(operation==='load'||operation==='ldi')++counter.loads;
 else if(operation==='store'||operation==='sti')++counter.stores;
}
