import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Delete the user's own data (favorites + account backups)
    await base44.asServiceRole.entities.Favorite.deleteMany({ user_email: user.email });
    await base44.asServiceRole.entities.AccountData.deleteMany({ account_email: user.email });

    // 2. Notify the admin to complete the removal of the account record itself
    let to = null;
    const rows = await base44.asServiceRole.entities.AppSettings.filter({ setting_key: 'contact_email' });
    if (rows[0]?.setting_value) to = rows[0].setting_value;
    if (!to) {
      const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      to = admins[0]?.email;
    }

    if (to) {
      const body =
        'طلب حذف حساب\n\n' +
        'الاسم: ' + (user.full_name || '-') + '\n' +
        'البريد الإلكتروني: ' + user.email + '\n' +
        'المعرّف: ' + user.id + '\n' +
        'التاريخ: ' + new Date().toISOString() + '\n\n' +
        'تم حذف بيانات المستخدم (المفضلات والنسخ الاحتياطية) تلقائيًا.\n' +
        'يرجى إتمام الحذف بإزالة حساب المستخدم من إدارة التطبيق.';
      await base44.asServiceRole.integrations.Core.SendEmail({
        to,
        subject: 'طلب حذف حساب — ' + user.email,
        body,
        from_name: 'دار العلوم',
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}