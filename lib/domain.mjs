export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const fail = (message, status = 400) => { throw new AppError(message, status); };
const text = (value, label, limit = 1000, required = false) => {
  if (typeof value !== 'string') value = '';
  value = value.trim();
  if ((required && !value) || value.length > limit) fail(`Check ${label}.`);
  return value;
};
export function date(value, required = true) {
  if (!value && !required) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Enter a valid date.');
  return value;
}
const number = (value, label, optional = false) => {
  if (optional && (value === '' || value == null)) return null;
  if (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000000) fail(`Check ${label}.`);
  return Number(value);
};
const choice = (value, choices, label) => { if (!choices.includes(value)) fail(`Check ${label}.`); return value; };
export function validTimezone(value) {
  try { new Intl.DateTimeFormat('en', {timeZone:value}).format(); } catch { fail('Choose a valid time zone.'); }
  return text(value, 'time zone', 100, true);
}
export function dayInZone(instant = new Date(), timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(instant);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validateRecord(type, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid record.');
  const notes = text(input.notes, 'notes', 3000);
  if (type === 'transfusion') return {
    date:date(input.date), location:text(input.location, 'location', 200),
    hbBefore:number(input.hbBefore, 'pre-transfusion hemoglobin', true), hbAfter:number(input.hbAfter, 'post-transfusion hemoglobin', true),
    hbUnit:choice(input.hbUnit, ['g/dL','g/L'], 'hemoglobin unit'), units:number(input.units, 'units received', true), notes
  };
  if (type === 'medication') {
    const times = [...new Set(Array.isArray(input.times) ? input.times : [])].sort();
    if (!times.length || times.length > 12 || times.some(t => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) fail('Enter daily times as HH:MM, separated by commas.');
    const startDate = date(input.startDate), endDate = date(input.endDate, false);
    if (endDate && endDate < startDate) fail('End date must be after the start date.');
    return { name:text(input.name,'medicine name',150,true), dose:text(input.dose,'prescribed dose',150,true), category:choice(input.category,['chelation','other'],'medicine type'), times, startDate, endDate, active:input.active !== false, notes };
  }
  if (type === 'appointment') {
    if (typeof input.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.at) || !Number.isFinite(Date.parse(input.at)) || new Date(input.at).toISOString() !== input.at) fail('Enter a valid appointment date and time.');
    return {title:text(input.title,'appointment title',200,true),kind:choice(input.kind,['transfusion','clinic','test','other'],'appointment type'),at:input.at,status:choice(input.status,['scheduled','completed','cancelled'],'appointment status'),location:text(input.location,'location',200),notes};
  }
  if (type === 'lab') return {test:text(input.test,'test name',150,true),value:number(input.value,'test result'),unit:text(input.unit,'result unit',50,true),date:date(input.date),reference:text(input.reference,'lab reference range',150),notes};
  if (type === 'care') return {title:text(input.title,'care item',200,true),category:choice(input.category,['deficiency','test','other'],'care category'),dueDate:date(input.dueDate,false),status:choice(input.status,['active','done'],'care status'),notes};
  if (type === 'profile') return {displayName:text(input.displayName,'display name',100,true),timeZone:validTimezone(input.timeZone)};
  fail('Unknown record type.');
}
export function medicationSlots(records, day) {
  return records.filter(r => r.type === 'medication' && r.data.active && r.data.startDate <= day && (!r.data.endDate || r.data.endDate >= day)).flatMap(r => r.data.times.map(time => ({medication:r,time}))).sort((a,b)=>a.time.localeCompare(b.time));
}
const stamp = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export function appointmentCalendar(record) {
  if (record.type !== 'appointment' || record.data.status !== 'scheduled') fail('Only scheduled appointments can be added to a calendar.');
  // Neutral text limits exposure if the user's calendar syncs to other services.
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Thalassaemia Care//Personal care//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${record.id}@thalassaemia-care.local`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(record.data.at)}`,`DTEND:${stamp(new Date(Date.parse(record.data.at)+30*60000))}`,'SUMMARY:Personal care appointment','DESCRIPTION:Check your care organizer for details.','CLASS:PRIVATE','BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY','DESCRIPTION:Personal care reminder','END:VALARM','BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY','DESCRIPTION:Personal care reminder','END:VALARM','END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
