// Design-only prototype. All evidence and identities are synthetic; no API calls.
const byId = (id) => document.getElementById(id);
const capabilities = ['ตอบคำขอ / จัดการงาน', 'จับงานอัตโนมัติ', 'สรุปบทสนทนา', 'อ่านภาพและ PDF', 'สร้างและแก้ภาพ'];
const scenarios = {
  connected: { label: 'การเชื่อมต่อพร้อม', title: 'ติดต่อบอทได้แล้ว', description: 'เครื่องบอทยังส่งข่าวมา และ WhatsApp เชื่อมต่ออยู่\nมีหลักฐานส่งคำตอบสำเร็จล่าสุดเมื่อ 13:18 น.', meta: ['✓ ติดต่อเครื่องได้', '✓ WhatsApp เชื่อมต่อ'], seal: '✓' },
  problem: { label: 'มีเรื่องให้ช่วยดู', title: 'WhatsApp หลุดไปสักพัก', description: 'เครื่องบอทยังติดต่อได้ แต่ WhatsApp ขาดการเชื่อมต่อมา 6 นาที\nคำขอใหม่อาจยังไม่ถึงบอท ลองตรวจที่เครื่องกันก่อน', meta: ['✓ ติดต่อเครื่องได้', '! WhatsApp หลุดตั้งแต่ 13:14 น.'], seal: '!', help: 'เว็บเห็นว่า WhatsApp หลุด แต่ยังบอกสาเหตุไม่ได้จากข้อมูลนี้อย่างเดียว', steps: ['ตรวจอินเทอร์เน็ตบนเครื่องบอท', 'ดู WhatsApp ว่าอุปกรณ์ยังลิงก์อยู่หรือไม่', 'ถ้าระบบขอให้ลิงก์ใหม่ ให้ผู้ดูแลตรวจและเชื่อมต่ออีกครั้ง'] },
  stale: { label: 'ยังยืนยันสถานะตอนนี้ไม่ได้', title: 'ไม่ได้ข่าวจากบอทสักพัก', description: 'รับสถานะครั้งล่าสุดเมื่อ 13:10 น. หรือ 10 นาทีที่แล้ว\nข้อมูลด้านล่างเป็นข้อมูลเก่า ยังใช้ยืนยันว่าบอททำงานอยู่ตอนนี้ไม่ได้', meta: ['— เครื่องบอท: ยังไม่ยืนยัน', '— WhatsApp: ยังไม่ยืนยัน'], seal: '?', help: 'เครื่องอาจหลับ อินเทอร์เน็ตอาจหลุด หรือบอทอาจหยุดทำงาน ยังสรุปสาเหตุไม่ได้', steps: ['ตรวจว่า Mac เปิดอยู่และไม่หลับ', 'ตรวจการเชื่อมต่ออินเทอร์เน็ต', 'ให้ผู้ดูแลตรวจว่าโปรแกรมบอทยังทำงานอยู่'] },
  waiting: { label: 'ยังไม่มีข้อมูล', title: 'ยังรอข่าวจากบอท', description: 'เมื่อบอทเริ่มส่งสถานะ เราจะเห็นการเชื่อมต่อและงานที่กำลังทำที่นี่\nตอนนี้ยังไม่มีข้อมูลพอจะบอกว่าบอทพร้อมหรือไม่', meta: ['— รอสถานะเครื่อง', '— รอสถานะ WhatsApp'], seal: '…' },
};
function renderScenario() {
  const key = byId('scenario').value;
  const state = scenarios[key];
  const waiting = key === 'waiting', stale = key === 'stale';
  byId('hero').dataset.state = key;
  byId('status-label').textContent = state.label;
  byId('headline').textContent = state.title;
  byId('description').textContent = state.description;
  byId('description').style.whiteSpace = 'pre-line';
  byId('seal').textContent = state.seal;
  byId('hero-meta').replaceChildren(...state.meta.map((text) => { const span = document.createElement('span'); span.textContent = text; return span; }));
  byId('hero-meta').style.color = key === 'connected' ? 'var(--green)' : 'var(--muted)';
  byId('help').hidden = !state.help;
  byId('received').textContent = waiting ? 'ยังไม่ได้รับข้อมูล' : stale ? '16 พ.ย. · 13:10:00' : '16 พ.ย. · 13:20:00';
  byId('freshness').textContent = waiting ? 'รอเชื่อมต่อ · ตัวอย่าง' : stale ? '10 นาทีที่แล้ว · เวลาตัวอย่าง' : '20 วินาทีที่แล้ว · เวลาตัวอย่าง';
  byId('inbound').textContent = waiting ? 'ยังไม่มีข้อมูล' : stale ? '13:07 น.' : key === 'problem' ? '13:12 น.' : '13:17 น.';
  byId('sent').textContent = waiting ? 'ยังไม่มีข้อมูล' : stale ? '13:08 น.' : key === 'problem' ? '13:13 น.' : '13:18 น.';
  byId('inbound-note').textContent = waiting ? 'จะแสดงเมื่อบอทรายงานเข้ามา' : '16 พ.ย. · ' + (stale ? 'ข้อมูลที่เคยได้รับ ยังไม่ยืนยันตอนนี้' : 'จากข้อความที่บอทได้รับ');
  byId('sent-note').textContent = waiting ? 'ยังไม่มีหลักฐานการส่ง' : '16 พ.ย. · ' + (stale ? 'หลักฐานเก่า ยังไม่ยืนยันตอนนี้' : 'ยังไม่เท่ากับผู้รับได้รับหรืออ่านแล้ว');
  byId('model-age').textContent = waiting ? 'รอข้อมูลจากบอท' : stale ? 'ข้อมูลเก่า · 13:10 น.' : 'ข้อมูลล่าสุด';
  byId('queue-age').textContent = waiting ? 'ยังไม่ทราบ' : stale ? 'ข้อมูลเก่า' : 'ตอนนี้';
  document.querySelectorAll('.queue-value').forEach((el, i) => { el.textContent = waiting ? 'ยังไม่ทราบ' : key === 'problem' && i === 0 ? 'รอ 3 งาน' : i === 2 ? '1 งาน · รอ 0' : 'ว่างอยู่'; });
  byId('queue-note').textContent = waiting ? 'ยังไม่มีข้อมูลคิวงานจากบอท' : stale ? 'จำนวนนี้เป็นข้อมูลที่เคยได้รับ ไม่ใช่จำนวนงานตอนนี้' : key === 'problem' ? 'มีงานรออยู่ ระหว่างที่ WhatsApp ขาดการเชื่อมต่อ' : 'งานสร้างภาพอาจใช้เวลาสักหน่อย กำลังทำอยู่ ยังไม่ได้แปลว่ามีปัญหา';
  byId('ai-list').replaceChildren();
  byId('response-models').replaceChildren();
  capabilities.forEach((name, i) => {
    const row = document.createElement('div'); row.className = 'ai-row';
    const content = document.createElement('div');
    const title = document.createElement('div'); title.className = 'ai-name'; title.textContent = name;
    const model = document.createElement('div'); model.className = 'ai-model';
    const provider = document.createElement('span'); provider.className = 'provider'; provider.textContent = waiting ? 'ยังไม่ทราบผู้ให้บริการ' : 'OpenAI';
    const code = document.createElement('span'); code.className = 'mono'; code.textContent = waiting ? 'รอชื่อโมเดล' : i === 4 ? 'example-image-model' : 'example-text-model';
    model.append(provider, code); content.append(title, model);
    const result = document.createElement('div'); result.className = 'ai-result' + (waiting || stale ? ' unknown' : ''); result.textContent = waiting ? 'ยังไม่ทราบ' : stale ? 'ผลครั้งเก่า: สำเร็จ' : 'ครั้งล่าสุดสำเร็จ';
    const time = document.createElement('small'); time.textContent = waiting ? 'ไม่มีผลการเรียกใช้' : '16 พ.ย. · 13:05 น.'; result.append(time); row.append(content, result); byId('ai-list').append(row);
    const detail = document.createElement('li'); detail.textContent = name + ': ' + (waiting || i === 4 ? 'ยังไม่มีชื่อโมเดลยืนยันจากผลตอบกลับ' : 'example-response-model'); byId('response-models').append(detail);
  });
}
byId('scenario').addEventListener('change', renderScenario);
byId('help').addEventListener('click', () => {
  const state = scenarios[byId('scenario').value];
  byId('help-title').textContent = byId('scenario').value === 'problem' ? 'ลองเช็กการเชื่อมต่อ WhatsApp' : 'ลองดูที่เครื่องบอท';
  byId('help-description').textContent = state.help;
  byId('help-steps').replaceChildren(...state.steps.map((text) => { const li = document.createElement('li'); li.textContent = text; return li; }));
  byId('help-dialog').showModal();
});
byId('close-dialog').addEventListener('click', () => byId('help-dialog').close());
const tabs = [byId('overview-tab'), byId('history-tab')];
function selectTab(selected) {
  tabs.forEach((tab) => { const active = tab === selected; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; byId(tab.getAttribute('aria-controls')).hidden = !active; });
  byId('page-title').textContent = selected === tabs[0] ? 'แวะมาดูบอทกัน' : 'ย้อนดูเรื่องของบอท';
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs[1 - i];
    selectTab(next); next.focus();
  });
});
document.addEventListener('keydown', () => document.body.classList.add('keyboard'));
document.addEventListener('pointerdown', () => document.body.classList.remove('keyboard'));
renderScenario();
