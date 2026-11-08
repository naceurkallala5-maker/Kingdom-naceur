// The Executive Manager: the owner's only point of contact.
// It answers in Modern Standard Arabic, records real tasks for employees and
// raises approval requests. It never performs external actions.

import Anthropic from '@anthropic-ai/sdk';
import { containsLatin } from './arabic.js';
import { APPROVAL_KINDS, OfficeError } from './office.js';

const HISTORY_LIMIT = 20; // keep requests small: only recent turns are sent
const MAX_TOOL_ROUNDS = 4;

export class ExecutiveError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const BASE_PROMPT = `أنت ياسين الركباني، المدير التنفيذي لشركة مملكة ناصر لإنتاج المحتوى الإسلامي الرقمي على إنستغرام أولاً، ثم تيك توك ويوتيوب لاحقاً.

قواعد ملزمة:
- اكتب دائماً بالعربية الفصحى المعاصرة فقط. لا تستخدم أي حرف لاتيني إطلاقاً، واكتب أسماء المنصات بالعربية: إنستغرام، تيك توك، يوتيوب، ميتا. استخدم الأرقام 123.
- أنت حلقة الاتصال الوحيدة بين المالك وجميع الموظفين.
- وزّع العمل بأداة إنشاء المهام على الموظف المناسب حسب قسمه، وكلّف الموظف المطلوب فقط.
- لا تنشر، ولا تراسل، ولا تعلّق، ولا تنفق، ولا تغيّر الإعدادات، ولا تربط حساباً. كل ذلك يحتاج موافقة صريحة من المالك، فاستخدم أداة طلب القرار لرفعه إليه.
- نص القرآن الكريم لا يُكتب من الذاكرة أبداً، ولا يُقبل من الأحاديث إلا الصحيح والحسن مع المصدر. أي حكم شرعي أو فتوى يُرفع إلى المالك لمراجعته.
- لا تدّعِ أن موظفاً أنجز عملاً أو بدأه. إنشاء المهمة يعني تسجيلها فقط، وتنفيذها لم يبدأ بعد.
- كن مختصراً وواضحاً: ابدأ بالقرارات المطلوبة من المالك، ثم الملخص.`;

const TOOLS = [
  {
    name: 'create_task',
    description: 'Record a real task and assign it to one employee. Title and objective must be Arabic only.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        employee_id: { type: 'integer', description: 'Employee number from the roster.' },
        title: { type: 'string', description: 'Short task title in Arabic.' },
        objective: { type: 'string', description: 'Task objective in Arabic.' },
      },
      required: ['employee_id', 'title', 'objective'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_owner_decision',
    description: 'Raise a decision, approval or missing input to the owner in the NEEDS YOUR ATTENTION section. Text must be Arabic only.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: APPROVAL_KINDS },
        title: { type: 'string', description: 'Short Arabic title.' },
        details: { type: 'string', description: 'Arabic details: what, why, impact, options.' },
        employee_id: { type: 'integer', description: 'Employee raising the request (1 for yourself).' },
        task_id: { type: ['integer', 'null'], description: 'Related task number, or null.' },
      },
      required: ['kind', 'title', 'details', 'employee_id', 'task_id'],
      additionalProperties: false,
    },
  },
];

export function executiveConfig(env = process.env) {
  return { model: env.KINGDOM_MODEL_ADVANCED || null };
}

export class ExecutiveManager {
  constructor(office, { client = null, model = null } = {}) {
    this.office = office;
    this.model = model;
    this.client = client;
  }

  get configured() {
    return Boolean(this.model);
  }

  getClient() {
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  systemPrompt() {
    const roster = this.office.db.prepare('SELECT * FROM employees ORDER BY id').all()
      .map((e) => `${e.id}. ${e.name}: ${e.title} (${e.department})`).join('\n');
    return `${BASE_PROMPT}\n\nسجل الموظفين:\n${roster}`;
  }

  history() {
    return this.office.messages(HISTORY_LIMIT).map((m) => ({
      role: m.role === 'owner' ? 'user' : 'assistant',
      content: m.content,
    }));
  }

  runTool(block) {
    const input = block.input ?? {};
    try {
      if (block.name === 'create_task') {
        const t = this.office.createTask({ title: input.title, objective: input.objective, employeeId: input.employee_id });
        return { content: `تم تسجيل المهمة رقم ${t.id}.` };
      }
      if (block.name === 'request_owner_decision') {
        const a = this.office.requestApproval({
          kind: input.kind, title: input.title, details: input.details,
          employeeId: input.employee_id, taskId: input.task_id ?? null,
        });
        return { content: `تم رفع الطلب رقم ${a.id} إلى المالك.` };
      }
      return { content: 'أداة غير معروفة.', is_error: true };
    } catch (err) {
      const code = err instanceof OfficeError ? err.code : 'internal_error';
      const hint = code === 'non_arabic_text' ? 'النص يجب أن يكون بالعربية فقط دون أي حرف لاتيني.' : `خطأ: ${code}`;
      return { content: hint, is_error: true };
    }
  }

  async call(messages) {
    try {
      return await this.getClient().beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high' },
        system: this.systemPrompt(),
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new ExecutiveError('em_auth_error');
      if (err instanceof Anthropic.RateLimitError) throw new ExecutiveError('em_rate_limited');
      if (err instanceof Anthropic.APIConnectionError) throw new ExecutiveError('em_connection_error');
      if (err instanceof Anthropic.APIError) throw new ExecutiveError('em_api_error');
      throw err;
    }
  }

  /** Runs one owner turn: the tool loop, then an Arabic-only check on the reply. */
  async respond(ownerText) {
    // The owner's instruction is always recorded, even if the manager cannot answer yet.
    this.office.addMessage('owner', ownerText);
    if (!this.configured) throw new ExecutiveError('em_not_configured');
    const messages = this.history();
    let arabicRetryUsed = false;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.call(messages);
      if (response.stop_reason === 'refusal') throw new ExecutiveError('em_refused');
      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason === 'tool_use' && toolUses.length) {
        messages.push({
          role: 'user',
          content: toolUses.map((b) => ({ type: 'tool_result', tool_use_id: b.id, ...this.runTool(b) })),
        });
        continue;
      }

      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (!text) throw new ExecutiveError('em_empty_reply');
      if (containsLatin(text)) {
        if (arabicRetryUsed) throw new ExecutiveError('em_non_arabic');
        arabicRetryUsed = true;
        messages.push({ role: 'user', content: 'أعد كتابة ردك الأخير بالعربية الفصحى فقط، دون أي حرف لاتيني.' });
        continue;
      }
      return this.office.addMessage('executive', text);
    }
    throw new ExecutiveError('em_too_many_steps');
  }
}
