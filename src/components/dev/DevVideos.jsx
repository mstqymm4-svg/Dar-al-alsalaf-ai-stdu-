import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Eye, EyeOff, Upload, Save, Youtube, Star, StarOff,
  Video, Tv, Loader2,
} from "lucide-react";

// Extract YouTube video ID from URL
export function extractYoutubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function getThumbnail(youtubeUrl) {
  const id = extractYoutubeId(youtubeUrl);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "";
}

// ─── Video Channels Tab ───────────────────────────────────────────────────────
function ChannelsTab() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    name: "", channel_logo: "", description: "", youtube_url: "",
    category: "عام", sort_order: 0, visible: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const data = await base44.entities.VideoChannel.list("sort_order", 200);
    setChannels(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name) { toast.error("أدخل اسم القناة"); return; }
    try {
      if (editing) {
        await base44.entities.VideoChannel.update(editing.id, form);
        toast.success("تم تحديث القناة");
      } else {
        await base44.entities.VideoChannel.create(form);
        toast.success("تمت إضافة القناة");
      }
      setShowForm(false); setEditing(null);
      setForm({ name: "", channel_logo: "", description: "", youtube_url: "", category: "عام", sort_order: 0, visible: true });
      load();
    } catch (e) { toast.error("فشل الحفظ"); }
  };

  const handleUploadLogo = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm((prev) => ({ ...prev, channel_logo: file_url }));
      toast.success("تم رفع الشعار");
    } catch (e) { toast.error("فشل الرفع"); }
    setUploading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">قنوات الفيديو ({channels.length})</h3>
        <Button size="sm" onClick={() => {
          setEditing(null);
          setForm({ name: "", channel_logo: "", description: "", youtube_url: "", category: "عام", sort_order: channels.length, visible: true });
          setShowForm(true);
        }}>
          <Plus className="w-4 h-4 ml-1" /> إضافة قناة
        </Button>
      </div>

      {showForm && (
        <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">اسم القناة</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="قناة دار العلوم" className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">التصنيف</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="عام" className="h-9 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">رابط قناة اليوتيوب</Label>
            <Input value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
              placeholder="https://youtube.com/@..." className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">شعار القناة</Label>
            <div className="flex items-center gap-2">
              {form.channel_logo && <img src={form.channel_logo} alt="logo" className="w-10 h-10 rounded-lg object-cover border border-border" />}
              <label className="cursor-pointer flex-1">
                <input type="file" accept="image/*" onChange={handleUploadLogo} className="hidden" />
                <div className="flex items-center justify-center gap-2 h-9 rounded-lg border-2 border-dashed border-border hover:border-primary/50 text-xs text-muted-foreground">
                  {uploading ? "جاري الرفع..." : <><Upload className="w-3.5 h-3.5" /> رفع شعار</>}
                </div>
              </label>
            </div>
          </div>
          <div>
            <Label className="text-xs">وصف القناة</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="وصف مختصر" className="text-sm min-h-[60px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">ترتيب الظهور</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="h-9 text-sm" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v })} />
              <Label className="text-xs">{form.visible ? "ظاهرة" : "مخفية"}</Label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave}><Save className="w-4 h-4 ml-1" /> حفظ</Button>
            <Button size="sm" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>إلغاء</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-muted-foreground py-8">جاري التحميل...</p>
      ) : channels.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">لا توجد قنوات بعد</p>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => (
            <div key={ch.id} className={`flex items-center gap-3 bg-card border border-border rounded-xl p-3 ${!ch.visible ? "opacity-50" : ""}`}>
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                {ch.channel_logo
                  ? <img src={ch.channel_logo} alt={ch.name} className="w-full h-full rounded-lg object-cover" />
                  : <Tv className="w-5 h-5 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{ch.name}</p>
                <p className="text-xs text-muted-foreground truncate">{ch.category} • {ch.youtube_url || "بدون رابط"}</p>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={async () => {
                await base44.entities.VideoChannel.update(ch.id, { visible: !ch.visible }); load();
              }}>{ch.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                setEditing(ch);
                setForm({ name: ch.name, channel_logo: ch.channel_logo || "", description: ch.description || "", youtube_url: ch.youtube_url || "", category: ch.category || "عام", sort_order: ch.sort_order || 0, visible: ch.visible });
                setShowForm(true);
              }}><Pencil className="w-3.5 h-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={async () => {
                if (!confirm(`حذف "${ch.name}"؟`)) return;
                await base44.entities.VideoChannel.delete(ch.id); toast.success("تم الحذف"); load();
              }}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Videos Tab ───────────────────────────────────────────────────────────────
function VideosTab() {
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    title: "", youtube_url: "", description: "", channel_id: "",
    channel_name: "", category: "عام", video_type: "normal", duration: "", is_featured: false, visible: true, sort_order: 0,
  });
  const [fetchingMeta, setFetchingMeta] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [vData, chData] = await Promise.all([
      base44.entities.Video.list("-created_date", 500),
      base44.entities.VideoChannel.list("sort_order", 200),
    ]);
    setVideos(vData || []);
    setChannels(chData || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Auto-fill video data (title / channel / duration) from the YouTube URL ──
  // Only fills fields the admin left empty — manual entries are never overwritten.
  useEffect(() => {
    if (!showForm || !extractYoutubeId(form.youtube_url)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setFetchingMeta(true);
      try {
        const res = await base44.functions.invoke("fetchVideoMeta", { url: form.youtube_url });
        const meta = res.data || {};
        if (cancelled) return;
        setForm((prev) => ({
          ...prev,
          title: prev.title || meta.title || "",
          channel_name: prev.channel_name || meta.channel_name || "",
          duration: prev.duration || meta.duration || "",
        }));
      } catch (e) {
        /* silent — manual entry always remains possible */
      } finally {
        if (!cancelled) setFetchingMeta(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.youtube_url, showForm]);

  const handleSave = async () => {
    if (!form.title || !form.youtube_url) { toast.error("أدخل العنوان والرابط"); return; }
    const thumbnail = getThumbnail(form.youtube_url);
    const ch = channels.find((c) => c.id === form.channel_id);
    const data = {
  ...form,
  thumbnail,
  channel_name: ch?.name || form.channel_name || "",
  video_type: form.video_type || "normal",
};
    try {
      if (editing) {
        await base44.entities.Video.update(editing.id, data);
        toast.success("تم تحديث الفيديو");
      } else {
        await base44.entities.Video.create(data);
        toast.success("تمت إضافة الفيديو");
      }
      setShowForm(false); setEditing(null);
      setForm({
  title: "",
  youtube_url: "",
  description: "",
  channel_id: "",
  channel_name: "",
  category: "عام",
  duration: "",
  video_type: "normal",
  is_featured: false,
  visible: true,
  sort_order: 0,
});
      load();
    } catch (e) { toast.error("فشل الحفظ"); }
  };

  const filtered = videos.filter((v) =>
    !search || v.title?.includes(search) || v.category?.includes(search) || v.channel_name?.includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">الفيديوهات ({videos.length})</h3>
        <div className="flex gap-2">
          <Input placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-32 text-sm" />
          <Button size="sm" onClick={() => {
            setEditing(null);
            setForm({ title: "", youtube_url: "", description: "", channel_id: "", channel_name: "", category: "عام", duration: "", is_featured: false, visible: true, sort_order: videos.length });
            setShowForm(true);
          }}>
            <Plus className="w-4 h-4 ml-1" /> إضافة
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
          <div>
            <Label className="text-xs">
              عنوان الفيديو <span className="text-muted-foreground font-normal">(يُجلب تلقائيًا من الرابط — قابل للتعديل)</span>
            </Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="عنوان الفيديو" className="h-9 text-sm" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">رابط يوتيوب</Label>
              {fetchingMeta && (
                <span className="text-[10px] text-primary flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> جلب البيانات تلقائيًا...
                </span>
              )}
            </div>
            <Input value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
              placeholder="https://youtube.com/watch?v=..." className="h-9 text-sm" />
          </div>
          {form.youtube_url && (
            <img src={getThumbnail(form.youtube_url)} alt="thumbnail" className="w-full max-w-xs rounded-lg border border-border" />
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">القناة</Label>
              <Select value={form.channel_id} onValueChange={(v) => setForm({ ...form, channel_id: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="اختر قناة" /></SelectTrigger>
                <SelectContent>
                  {channels.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">التصنيف</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-9 text-sm" />
            </div>
            <div>
  <Label className="text-xs">نوع الفيديو</Label>

  <Select
    value={form.video_type || "normal"}
    onValueChange={(value) =>
      setForm({
        ...form,
        video_type: value,
      })
    }
  >
    <SelectTrigger className="h-9 text-sm">
      <SelectValue />
    </SelectTrigger>

    <SelectContent>
      <SelectItem value="normal">📺 فيديو عادي</SelectItem>
      <SelectItem value="short">🟣 شورت</SelectItem>
      <SelectItem value="live">🔴 بث مباشر</SelectItem>
    </SelectContent>
  </Select>
</div>
            <div>
              <Label className="text-xs">المدة (اختياري)</Label>
              <Input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}
                placeholder="10:30" className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">الترتيب</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="h-9 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">الوصف</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="text-sm min-h-[60px]" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={form.is_featured} onCheckedChange={(v) => setForm({ ...form, is_featured: v })} />
              مميز
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v })} />
              {form.visible ? "ظاهر" : "مخفي"}
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave}><Save className="w-4 h-4 ml-1" /> حفظ</Button>
            <Button size="sm" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>إلغاء</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-muted-foreground py-8">جاري التحميل...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">لا توجد فيديوهات</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((v) => (
            <div key={v.id} className={`bg-card border border-border rounded-xl p-3 ${!v.visible ? "opacity-50" : ""}`}>
              <div className="flex gap-3">
                {v.thumbnail && <img src={v.thumbnail} alt={v.title} className="w-24 h-16 rounded-lg object-cover shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{v.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{v.channel_name || "بدون قناة"}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {v.is_featured && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">مميز</span>}
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{v.category}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1 mt-2">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                  await base44.entities.Video.update(v.id, { is_featured: !v.is_featured }); load();
                }}>{v.is_featured ? <Star className="w-3 h-3 text-amber-500 fill-amber-500" /> : <StarOff className="w-3 h-3" />}</Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                  await base44.entities.Video.update(v.id, { visible: !v.visible }); load();
                }}>{v.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}</Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                  setEditing(v);
                  setForm({ title: v.title, youtube_url: v.youtube_url, description: v.description || "", channel_id: v.channel_id || "", channel_name: v.channel_name || "", category: v.category || "عام", duration: v.duration || "", is_featured: v.is_featured, visible: v.visible, sort_order: v.sort_order || 0 });
                  setShowForm(true);
                }}><Pencil className="w-3 h-3" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                  if (!confirm(`حذف "${v.title}"؟`)) return;
                  await base44.entities.Video.delete(v.id); toast.success("تم الحذف"); load();
                }}><Trash2 className="w-3 h-3 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function VideoSettingsTab() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("devs_videos_enabled") !== "false");
  const [showInfo, setShowInfo] = useState(() => localStorage.getItem("devs_videos_show_info") !== "false");

  const handleSave = () => {
    localStorage.setItem("devs_videos_enabled", String(enabled));
    localStorage.setItem("devs_videos_show_info", String(showInfo));
    toast.success("تم حفظ الإعدادات");
    window.dispatchEvent(new Event("app-settings-changed"));
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-bold">إعدادات الفيديوهات</h3>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">تفعيل قسم الفيديوهات</Label>
            <p className="text-xs text-muted-foreground">إظهار أو إخفاء قسم الفيديوهات عن المستخدمين</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">إظهار معلومات الفيديو</Label>
            <p className="text-xs text-muted-foreground">عرض العنوان والوصف واسم القناة أثناء التشغيل</p>
          </div>
          <Switch checked={showInfo} onCheckedChange={setShowInfo} />
        </div>
        <Button onClick={handleSave} className="w-full"><Save className="w-4 h-4 ml-2" /> حفظ الإعدادات</Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DevVideos() {
  const [tab, setTab] = useState("videos");
  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="videos" className="text-xs gap-1"><Video className="w-3.5 h-3.5" /> الفيديوهات</TabsTrigger>
          <TabsTrigger value="channels" className="text-xs gap-1"><Tv className="w-3.5 h-3.5" /> القنوات</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs gap-1"><Youtube className="w-3.5 h-3.5" /> الإعدادات</TabsTrigger>
        </TabsList>
        <TabsContent value="videos" className="mt-4"><VideosTab /></TabsContent>
        <TabsContent value="channels" className="mt-4"><ChannelsTab /></TabsContent>
        <TabsContent value="settings" className="mt-4"><VideoSettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}