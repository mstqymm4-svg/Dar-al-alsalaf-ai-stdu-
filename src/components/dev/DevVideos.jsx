import { useState, useEffect, useCallback, useRef } from "react";
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
  Video, Tv, Loader2, Sparkles, CheckCircle2, Clock, DownloadCloud, Flame, Play, CheckSquare, Square
} from "lucide-react";
import {
  extractYoutubeId,
  getThumbnail,
  fetchVideoMetadata,
  fetchChannelMetadata,
  normalizeChannelUrl,
  autoUploadChannelLogo,
  fetchChannelVideos
} from "@/lib/youtubeMeta";
import ChannelVideosImportModal from "@/components/dev/ChannelVideosImportModal";
import ShortsPlayerModal from "@/components/ShortsPlayerModal";
import { getSetting, setSettings, flushAllPendingSettings } from "@/lib/settingsStore";

export { extractYoutubeId, getThumbnail };

const isShortRecord = (v) =>
  Boolean(v && (v.video_type === "short" || String(v.youtube_url || "").includes("/shorts/")));

// ─── Video Channels Tab ───────────────────────────────────────────────────────
function ChannelsTab() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [fetchSuccess, setFetchSuccess] = useState(false);
  const [uploadingAutoLogo, setUploadingAutoLogo] = useState(false);
  const [importChannel, setImportChannel] = useState(null);
  const [importInitialType, setImportInitialType] = useState("all");
  const [autoImportOnCreate, setAutoImportOnCreate] = useState(false);
  const [autoImportLimit, setAutoImportLimit] = useState(10);
  const [savingAndImporting, setSavingAndImporting] = useState(false);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState(null);
  const [form, setForm] = useState({
    name: "", channel_logo: "", description: "", youtube_url: "",
    category: "عام", sort_order: 0, visible: true,
  });

  const lastFetchedUrl = useRef("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await base44.entities.VideoChannel.list("sort_order", 200);
    setChannels(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-fetch channel info and auto-upload channel logo when youtube_url is pasted or entered
  const fetchChannelData = useCallback(async (urlToFetch) => {
    if (!urlToFetch || urlToFetch.trim().length < 4) return;
    const normalized = normalizeChannelUrl(urlToFetch);
    if (lastFetchedUrl.current === normalized) return;
    lastFetchedUrl.current = normalized;

    setFetchingMeta(true);
    setFetchSuccess(false);
    try {
      const meta = await fetchChannelMetadata(normalized);
      if (meta && (meta.name || meta.channel_logo)) {
        const channelName = meta.name || form.name;

        // Set immediate data
        setForm((prev) => ({
          ...prev,
          name: prev.name ? prev.name : (meta.name || prev.name),
          channel_logo: meta.channel_logo || prev.channel_logo,
          description: prev.description ? prev.description : (meta.description || prev.description),
          youtube_url: meta.youtube_url || prev.youtube_url,
        }));
        setFetchSuccess(true);

        // Auto-upload channel logo into app storage
        if (meta.channel_logo) {
          setUploadingAutoLogo(true);
          try {
            const uploadedUrl = await autoUploadChannelLogo(meta.channel_logo, channelName);
            if (uploadedUrl) {
              setForm((prev) => ({ ...prev, channel_logo: uploadedUrl }));
            }
            toast.success(`تم جلب اسم القناة ورفع صورتها تلقائياً ✓`);
          } catch (uploadErr) {
            console.warn("Auto upload error, keeping extracted logo URL:", uploadErr);
            toast.success(`تم جلب بيانات القناة: ${meta.name || "بنجاح"}`);
          } finally {
            setUploadingAutoLogo(false);
          }
        } else {
          toast.success(`تم جلب بيانات القناة: ${meta.name || "بنجاح"}`);
        }
      }
    } catch (err) {
      console.warn("Channel auto-fetch error:", err);
    } finally {
      setFetchingMeta(false);
    }
  }, [form.name]);

  useEffect(() => {
    if (!showForm || !form.youtube_url) return;
    const trimmed = form.youtube_url.trim();
    if (trimmed.length < 5) return;

    const timer = setTimeout(() => {
      fetchChannelData(trimmed);
    }, 700);

    return () => clearTimeout(timer);
  }, [form.youtube_url, showForm, fetchChannelData]);

  const handleSave = async () => {
    if (!form.name) { toast.error("أدخل اسم القناة"); return; }
    setSavingAndImporting(true);
    try {
      if (editing) {
        await base44.entities.VideoChannel.update(editing.id, form);
        toast.success("تم تحديث القناة");
        setShowForm(false);
        setEditing(null);
        load();
      } else {
        const newCh = await base44.entities.VideoChannel.create(form);
        toast.success("تمت إضافة القناة بنجاح");

        // If auto-import is enabled on creation
        if (autoImportOnCreate && form.youtube_url) {
          toast.info(`جاري استخراج ورفع ${autoImportLimit} فيديو من القناة تلقائياً...`);
          try {
            const fetchedVideos = await fetchChannelVideos(form.youtube_url, autoImportLimit);
            if (fetchedVideos && fetchedVideos.length > 0) {
              let count = 0;
              for (const v of fetchedVideos) {
                await base44.entities.Video.create({
                  title: v.title,
                  youtube_url: v.youtube_url,
                  duration: v.duration || "",
                  thumbnail: v.thumbnail || getThumbnail(v.youtube_url),
                  channel_id: newCh.id,
                  channel_name: form.name,
                  category: form.category || "عام",
                  video_type: v.video_type || "normal",
                  description: v.description || "",
                  is_featured: false,
                  visible: true,
                  sort_order: 0,
                });
                count++;
              }
              toast.success(`تم استيراد ${count} فيديو تلقائياً من القناة! 🎉`);
            } else {
              toast.warning("تمت إضافة القناة، لكن لم يتم العثور على فيديوهات جديدة لاستيرادها");
            }
          } catch (importErr) {
            console.warn("Auto import error on create:", importErr);
            toast.error("تعذر استيراد الفيديوهات تلقائياً، يمكنك استيرادها لاحقاً");
          }
        }

        setShowForm(false);
        setEditing(null);
        setAutoImportOnCreate(false);
        setForm({ name: "", channel_logo: "", description: "", youtube_url: "", category: "عام", sort_order: 0, visible: true });
        await load();
      }
    } catch (e) {
      toast.error("فشل الحفظ: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setSavingAndImporting(false);
    }
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
          lastFetchedUrl.current = "";
          setFetchSuccess(false);
          setForm({ name: "", channel_logo: "", description: "", youtube_url: "", category: "عام", sort_order: channels.length, visible: true });
          setShowForm(true);
        }}>
          <Plus className="w-4 h-4 ml-1" /> إضافة قناة
        </Button>
      </div>

      {showForm && (
        <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">رابط قناة اليوتيوب أو المعرّف</Label>
              <div className="flex items-center gap-1.5 text-[11px]">
                {fetchingMeta && (
                  <span className="text-primary flex items-center gap-1 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" /> جلب بيانات القناة تلقائياً...
                  </span>
                )}
                {fetchSuccess && !fetchingMeta && (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3 h-3" /> تم الجلب التلقائي
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                value={form.youtube_url}
                onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (pasted) fetchChannelData(pasted);
                }}
                placeholder="https://youtube.com/@channelName أو @channelName"
                className="h-9 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fetchingMeta || !form.youtube_url}
                onClick={() => fetchChannelData(form.youtube_url)}
                className="shrink-0 h-9 text-xs gap-1"
                title="جلب اسم وشعار القناة تلقائياً من الرابط"
              >
                {fetchingMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-primary" />}
                جلب تلقائي
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              💡 بمجرد وضع رابط القناة أو المعرف، سيتم كتابة اسم القناة وجلب شعارها تلقائياً.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">
                اسم القناة {fetchingMeta && <Loader2 className="w-3 h-3 inline animate-spin text-primary mr-1" />}
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="قناة DAR AL TAWHID"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">التصنيف</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="عام"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">شعار / صورة القناة</Label>
              {uploadingAutoLogo && (
                <span className="text-[11px] text-primary flex items-center gap-1 animate-pulse font-medium">
                  <Loader2 className="w-3 h-3 animate-spin" /> جاري رفع وحفظ صورة القناة تلقائياً...
                </span>
              )}
              {form.channel_logo && !uploadingAutoLogo && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> تم استخراج ورفع صورة القناة تلقائياً
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {form.channel_logo ? (
                <div className="relative group">
                  <img
                    src={form.channel_logo}
                    alt="logo"
                    className="w-12 h-12 rounded-xl object-cover border border-border shadow-sm ring-2 ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, channel_logo: "" }))}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="إزالة الشعار"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="w-12 h-12 rounded-xl bg-muted/60 border border-dashed border-border flex items-center justify-center text-muted-foreground">
                  {uploadingAutoLogo ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <Tv className="w-5 h-5 opacity-40" />}
                </div>
              )}
              <div className="flex-1 flex gap-2">
                <Input
                  value={form.channel_logo}
                  onChange={(e) => setForm({ ...form, channel_logo: e.target.value })}
                  placeholder="رابط صورة الشعار (يُجلب ويُرفع تلقائياً من رابط القناة)"
                  className="h-9 text-xs flex-1"
                />
                <label className="cursor-pointer shrink-0">
                  <input type="file" accept="image/*" onChange={handleUploadLogo} className="hidden" />
                  <div className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-border hover:bg-muted text-xs text-muted-foreground">
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Upload className="w-3.5 h-3.5" /> رفع ملف</>}
                  </div>
                </label>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              💡 صورة القناة تُجلب وتُرفع تلقائياً من رابط اليوتيوب، كما يمكنك استبدالها برفع صورة يدوياً إذا رغبت.
            </p>
          </div>

          <div>
            <Label className="text-xs">وصف القناة</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="وصف مختصر للقناة ومحتواها"
              className="text-sm min-h-[60px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">ترتيب الظهور</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v })} />
              <Label className="text-xs">{form.visible ? "ظاهرة" : "مخفية"}</Label>
            </div>
          </div>

          {/* Automatic video extraction option on channel creation */}
          {!editing && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-bold text-foreground flex items-center gap-1.5 cursor-pointer">
                    <Video className="w-4 h-4 text-primary" />
                    استخراج ورفع فيديوهات القناة تلقائياً فور الحفظ
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    سحب مقاطع القناة مع العناوين والمدد والصور وحفظها في قائمة الفيديوهات تلقائياً
                  </p>
                </div>
                <Switch
                  checked={autoImportOnCreate}
                  onCheckedChange={setAutoImportOnCreate}
                />
              </div>

              {autoImportOnCreate && (
                <div className="flex items-center gap-3 pt-2 border-t border-primary/10">
                  <Label className="text-xs shrink-0 font-medium">عدد الفيديوهات المطلوبة:</Label>
                  <Select value={String(autoImportLimit)} onValueChange={(v) => setAutoImportLimit(Number(v))}>
                    <SelectTrigger className="h-8 text-xs w-36 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">فيديو واحد (1)</SelectItem>
                      <SelectItem value="5">5 فيديوهات</SelectItem>
                      <SelectItem value="10">10 فيديوهات</SelectItem>
                      <SelectItem value="20">20 فيديو</SelectItem>
                      <SelectItem value="30">30 فيديو</SelectItem>
                      <SelectItem value="50">50 فيديو</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={savingAndImporting} className="gap-1.5">
              {savingAndImporting ? (
                <>
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" /> جاري الحفظ واستخراج الفيديوهات...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 ml-1" /> حفظ القناة
                </>
              )}
            </Button>
            <Button size="sm" variant="outline" disabled={savingAndImporting} onClick={() => { setShowForm(false); setEditing(null); }}>
              إلغاء
            </Button>
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
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0 overflow-hidden border border-border">
                {ch.channel_logo ? (
                  <img src={ch.channel_logo} alt={ch.name} className="w-full h-full object-cover" />
                ) : (
                  <Tv className="w-5 h-5 text-red-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{ch.name}</p>
                <p className="text-xs text-muted-foreground truncate" dir="ltr">{ch.youtube_url || "بدون رابط"}</p>
              </div>

              {/* Import Videos & Shorts Buttons */}
              {ch.youtube_url && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-xs gap-1 text-purple-600 border-purple-500/30 hover:bg-purple-500/10 shrink-0"
                    onClick={() => {
                      setImportInitialType("shorts");
                      setImportChannel(ch);
                    }}
                    title="سحب المقاطع القصيرة (Shorts) من القناة تلقائياً"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">شورتس القناة</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-xs gap-1.5 text-primary border-primary/30 hover:bg-primary/10 shrink-0"
                    onClick={() => {
                      setImportInitialType("videos");
                      setImportChannel(ch);
                    }}
                    title="استخراج واستيراد فيديوهات القناة"
                  >
                    <DownloadCloud className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">استيراد فيديوهات</span>
                  </Button>
                </div>
              )}

              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={async () => {
                try {
                  await base44.entities.VideoChannel.update(ch.id, { visible: !ch.visible });
                  await load();
                } catch (err) {
                  toast.error("فشل التحديث: " + (err?.message || "خطأ غير معروف"));
                }
              }}>{ch.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                setEditing(ch);
                lastFetchedUrl.current = ch.youtube_url || "";
                setForm({
                  name: ch.name,
                  channel_logo: ch.channel_logo || "",
                  description: ch.description || "",
                  youtube_url: ch.youtube_url || "",
                  category: ch.category || "عام",
                  sort_order: ch.sort_order || 0,
                  visible: ch.visible
                });
                setShowForm(true);
              }}><Pencil className="w-3.5 h-3.5" /></Button>
              {confirmDeleteChannelId === ch.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={async () => {
                    setConfirmDeleteChannelId(null);
                    try {
                      await base44.entities.VideoChannel.delete(ch.id);
                      toast.success("تم حذف القناة بنجاح ✓");
                      await load();
                    } catch (err) {
                      toast.error("فشل الحذف: " + (err?.message || "خطأ غير معروف"));
                    }
                  }}>تأكيد</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setConfirmDeleteChannelId(null)}>
                    إلغاء
                  </Button>
                </div>
              ) : (
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setConfirmDeleteChannelId(ch.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Import Channel Videos Modal */}
      <ChannelVideosImportModal
        channel={importChannel}
        initialType={importInitialType}
        isOpen={Boolean(importChannel)}
        onClose={() => setImportChannel(null)}
        onSuccess={load}
      />
    </div>
  );
}

// ─── Dedicated Shorts Tab ─────────────────────────────────────────────────────
function ShortsTab() {
  const [shorts, setShorts] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [fetchSuccess, setFetchSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [previewShortIndex, setPreviewShortIndex] = useState(null);

  // Channel Shorts Importer state
  const [selectedChannelIdForImport, setSelectedChannelIdForImport] = useState("");
  const [customChannelUrl, setCustomChannelUrl] = useState("");
  const [importTargetChannel, setImportTargetChannel] = useState(null);
  const [resolvingChannel, setResolvingChannel] = useState(false);

  const lastFetchedId = useRef("");

  const [form, setForm] = useState({
    title: "",
    youtube_url: "",
    file_url: "",
    thumbnail: "",
    channel_id: "",
    channel_name: "",
    category: "عام",
    visible: true,
    sort_order: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vData, chData] = await Promise.all([
        base44.entities.Video.list("-created_date", 500),
        base44.entities.VideoChannel.list("sort_order", 200),
      ]);
      const onlyShorts = (vData || []).filter((v) => isShortRecord(v));
      setShorts(onlyShorts);
      setChannels(chData || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-fill Short metadata when pasting URL
  const fetchShortMeta = useCallback(async (urlToFetch) => {
    const videoId = extractYoutubeId(urlToFetch);
    if (!videoId) return null;
    if (lastFetchedId.current === videoId && form.title) return null;
    lastFetchedId.current = videoId;

    setFetchingMeta(true);
    setFetchSuccess(false);
    try {
      const meta = await fetchVideoMetadata(urlToFetch);
      if (meta) {
        const matchedChannel = channels.find((c) =>
          c.name && meta.channel_name && (
            c.name.trim().toLowerCase() === meta.channel_name.trim().toLowerCase() ||
            meta.channel_name.includes(c.name) ||
            c.name.includes(meta.channel_name)
          )
        );
        setForm((prev) => ({
          ...prev,
          title: meta.title || prev.title,
          thumbnail: meta.thumbnail || prev.thumbnail,
          channel_name: matchedChannel?.name || meta.channel_name || prev.channel_name,
          channel_id: matchedChannel ? matchedChannel.id : prev.channel_id,
          category: matchedChannel?.category || prev.category || "عام",
        }));
        setFetchSuccess(true);
        toast.success(`تم جلب اسم المقطع القصير والقناة تلقائياً ✓`);
        return meta;
      }
    } catch (err) {
      console.warn("Short auto-fetch error:", err);
    } finally {
      setFetchingMeta(false);
    }
    return null;
  }, [channels, form.title]);

  useEffect(() => {
    if (!showAddForm || !form.youtube_url) return;
    const videoId = extractYoutubeId(form.youtube_url);
    if (!videoId) return;
    const timer = setTimeout(() => {
      fetchShortMeta(form.youtube_url);
    }, 350);
    return () => clearTimeout(timer);
  }, [form.youtube_url, showAddForm, fetchShortMeta]);

  const handleUploadShortFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      const fileUrl = res?.file_url || URL.createObjectURL(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ");
      setForm((prev) => ({
        ...prev,
        file_url: fileUrl,
        youtube_url: prev.youtube_url || fileUrl,
        title: prev.title || cleanName || "مقطع قصير",
      }));
      toast.success("تم رفع ملف الشورت بنجاح ✓");
    } catch (err) {
      toast.error("تعذر رفع ملف الفيديو: " + (err?.message || ""));
    } finally {
      setUploadingVideo(false);
      e.target.value = "";
    }
  };

  const handleSaveShort = async () => {
    const rawUrl = (form.youtube_url || form.file_url || "").trim();
    if (!rawUrl) {
      toast.error("يرجى إدخال رابط الشورت أو رفع ملف الفيديو");
      return;
    }
    setSaving(true);
    try {
      let resolvedTitle = (form.title || "").trim();
      let resolvedChannelName = (form.channel_name || "").trim();
      let resolvedChannelId = form.channel_id || "";

      // If user clicked save immediately after pasting before title loaded, try a quick 1.5s metadata fetch
      const ytId = extractYoutubeId(rawUrl);
      if (!resolvedTitle && ytId) {
        try {
          const meta = await Promise.race([
            fetchVideoMetadata(rawUrl),
            new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);
          if (meta?.title) resolvedTitle = meta.title.trim();
          if (meta?.channel_name && !resolvedChannelName) resolvedChannelName = meta.channel_name.trim();
        } catch {}
      }

      const ch = channels.find((c) => c.id === resolvedChannelId);
      if (ch && !resolvedChannelName) resolvedChannelName = ch.name;
      if (!resolvedTitle) {
        resolvedTitle = resolvedChannelName
          ? `مقطع قصير — ${resolvedChannelName}`
          : ytId
          ? `مقطع قصير #${ytId.slice(0, 6)}`
          : "مقطع قصير";
      }

      const normalizedUrl = ytId && !rawUrl.includes("/shorts/") && !form.file_url
        ? `https://www.youtube.com/shorts/${ytId}`
        : rawUrl;
      const thumbnail = form.thumbnail || (ytId ? getThumbnail(rawUrl) : "");

      const payload = {
        ...form,
        title: resolvedTitle,
        youtube_url: normalizedUrl,
        file_url: form.file_url || "",
        thumbnail,
        channel_name: ch?.name || resolvedChannelName || "",
        video_type: "short",
        duration: "0:60",
        is_featured: false,
      };

      if (editing) {
        const updated = await base44.entities.Video.update(editing.id, payload);
        setShorts((prev) => prev.map((item) => (item.id === editing.id ? { ...item, ...payload, ...(updated || {}) } : item)));
        toast.success("تم تحديث المقطع القصير (Short) ✓");
      } else {
        const created = await base44.entities.Video.create(payload);
        if (created) {
          setShorts((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
        }
        toast.success("تمت إضافة المقطع القصير (Short) بنجاح ✓");
      }
      setShowAddForm(false);
      setEditing(null);
      lastFetchedId.current = "";
      setForm({
        title: "",
        youtube_url: "",
        file_url: "",
        thumbnail: "",
        channel_id: "",
        channel_name: "",
        category: "عام",
        visible: true,
        sort_order: 0,
      });
      await load();
    } catch (err) {
      toast.error("فشل الحفظ: " + (err?.message || "خطأ غير معروف"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSingleShort = async (id) => {
    setConfirmDeleteId(null);
    // Optimistically remove from state immediately
    setShorts((prev) => prev.filter((item) => item.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    try {
      await base44.entities.Video.delete(id);
      toast.success("تم حذف الشورت نهائياً ✓");
    } catch (err) {
      toast.error("فشل الحذف: " + (err?.message || ""));
      await load();
    }
  };

  const handleBulkDeleteShorts = async () => {
    if (selectedIds.length === 0) return;
    const toDelete = [...selectedIds];
    setConfirmBulkDelete(false);
    setSelectedIds([]);
    setShorts((prev) => prev.filter((item) => !toDelete.includes(item.id)));
    try {
      await Promise.all(toDelete.map((id) => base44.entities.Video.delete(id)));
      toast.success(`تم حذف ${toDelete.length} شورت بنجاح ✓`);
    } catch {
      toast.error("حدث خطأ أثناء حذف بعض المقاطع");
      await load();
    }
  };

  const toggleSelectShort = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleOpenChannelShortsImporter = async () => {
    const url = customChannelUrl.trim();
    if (!url && !selectedChannelIdForImport) {
      toast.error("اختر قناة من القائمة أو الصق رابط القناة");
      return;
    }
    const matched = channels.find(
      (c) => c.id === selectedChannelIdForImport || (url && c.youtube_url === url)
    );
    if (matched) {
      setImportTargetChannel(matched);
      return;
    }
    setResolvingChannel(true);
    try {
      const meta = await fetchChannelMetadata(url);
      setImportTargetChannel({
        id: "",
        name: meta?.name || "قناة يوتيوب",
        channel_logo: meta?.channel_logo || "",
        youtube_url: meta?.youtube_url || normalizeChannelUrl(url),
        category: "عام",
      });
    } catch {
      setImportTargetChannel({
        id: "",
        name: "قناة يوتيوب",
        channel_logo: "",
        youtube_url: normalizeChannelUrl(url),
        category: "عام",
      });
    } finally {
      setResolvingChannel(false);
    }
  };

  const filteredShorts = shorts.filter(
    (s) =>
      !search ||
      s.title?.toLowerCase().includes(search.toLowerCase()) ||
      s.channel_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.category?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Top Banner: 1-Click Channel Shorts Extractor */}
      <div className="bg-purple-500/5 border border-purple-500/25 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
              <Flame className="w-4 h-4 fill-current" />
              سحب المقاطع القصيرة (Shorts) تلقائياً من القناة
            </h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              اختر قناة أو الصق رابطها وسيقوم النظام تلقائياً بجلب جميع مقاطع الشورتس مع عناوينها وصورها واسم القناة
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
          <div className="sm:col-span-5">
            <Label className="text-xs mb-1 block">اختر من القنوات المضافة:</Label>
            <Select
              value={selectedChannelIdForImport}
              onValueChange={(val) => {
                setSelectedChannelIdForImport(val);
                const ch = channels.find((c) => c.id === val);
                if (ch?.youtube_url) setCustomChannelUrl(ch.youtube_url);
              }}
            >
              <SelectTrigger className="h-9 text-xs bg-background">
                <SelectValue placeholder="اختر قناة..." />
              </SelectTrigger>
              <SelectContent>
                {channels.filter((c) => c.youtube_url).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-5">
            <Label className="text-xs mb-1 block">أو الصق رابط أي قناة يوتيوب:</Label>
            <Input
              value={customChannelUrl}
              onChange={(e) => setCustomChannelUrl(e.target.value)}
              placeholder="https://youtube.com/@channelName"
              className="h-9 text-xs bg-background"
              dir="ltr"
            />
          </div>

          <div className="sm:col-span-2">
            <Button
              size="sm"
              disabled={resolvingChannel || (!customChannelUrl.trim() && !selectedChannelIdForImport)}
              onClick={handleOpenChannelShortsImporter}
              className="w-full h-9 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold gap-1"
            >
              {resolvingChannel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>جلب الشورتس</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Toolbar: Search + Bulk Actions + Add Single Short */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <span>🟣 المقاطع القصيرة المضافة ({shorts.length})</span>
          </h3>
          {filteredShorts.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 px-2"
              onClick={() => {
                if (selectedIds.length === filteredShorts.length) {
                  setSelectedIds([]);
                } else {
                  setSelectedIds(filteredShorts.map((s) => s.id));
                }
              }}
            >
              {selectedIds.length === filteredShorts.length && filteredShorts.length > 0 ? (
                <CheckSquare className="w-3.5 h-3.5 text-purple-600" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <span>{selectedIds.length === filteredShorts.length ? "إلغاء التحديد" : "تحديد الكل"}</span>
            </Button>
          )}
          {selectedIds.length > 0 && (
            confirmBulkDelete ? (
              <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/30 px-2 py-0.5 rounded-lg">
                <span className="text-[11px] font-bold text-destructive">حذف {selectedIds.length} شورت؟</span>
                <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={handleBulkDeleteShorts}>
                  تأكيد الحذف
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => setConfirmBulkDelete(false)}>
                  إلغاء
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-[11px] gap-1 px-2.5"
                onClick={() => setConfirmBulkDelete(true)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف المحدد ({selectedIds.length})</span>
              </Button>
            )
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="بحث في الشورتس..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <Button
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1"
            onClick={() => {
              setEditing(null);
              lastFetchedId.current = "";
              setFetchSuccess(false);
              setForm({
                title: "",
                youtube_url: "",
                file_url: "",
                thumbnail: "",
                channel_id: "",
                channel_name: "",
                category: "عام",
                visible: true,
                sort_order: shorts.length,
              });
              setShowAddForm((prev) => !prev);
            }}
          >
            <Plus className="w-4 h-4" /> إضافة شورت جديد
          </Button>
        </div>
      </div>

      {/* Add / Edit Single Short Form */}
      {showAddForm && (
        <div className="bg-muted/30 border border-purple-500/30 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-bold">رابط المقطع القصير (YouTube Shorts أو أي رابط فيديو)</Label>
                <div className="flex items-center gap-1.5 text-[11px]">
                  {fetchingMeta && (
                    <span className="text-purple-600 flex items-center gap-1 animate-pulse font-medium">
                      <Loader2 className="w-3 h-3 animate-spin" /> جاري جلب الاسم والقناة تلقائياً...
                    </span>
                  )}
                  {fetchSuccess && !fetchingMeta && (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3 h-3" /> تم جلب البيانات تلقائياً
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={form.youtube_url}
                  onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text");
                    if (pasted) fetchShortMeta(pasted);
                  }}
                  placeholder="https://youtube.com/shorts/..."
                  className="h-9 text-sm"
                  dir="ltr"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={fetchingMeta || !form.youtube_url}
                  onClick={() => fetchShortMeta(form.youtube_url)}
                  className="shrink-0 h-9 text-xs gap-1"
                >
                  {fetchingMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-purple-600" />}
                  جلب الاسم
                </Button>
              </div>
            </div>

            <div className="sm:col-span-4">
              <Label className="text-xs font-bold mb-1 block">أو رفع ملف فيديو قصير (MP4)</Label>
              <label className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 text-purple-700 dark:text-purple-300 text-xs font-bold cursor-pointer transition-colors">
                {uploadingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{uploadingVideo ? "جاري رفع الفيديو..." : form.file_url ? "تم رفع ملف الفيديو ✓" : "اختر ملف فيديو MP4"}</span>
                <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleUploadShortFile} disabled={uploadingVideo} />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
            {/* 9:16 Vertical Preview */}
            {(form.youtube_url || form.file_url) && (
              <div className="sm:col-span-3 flex justify-center">
                <div className="w-28 aspect-[9/16] rounded-xl overflow-hidden bg-black border border-purple-500/30 relative shadow-md">
                  {extractYoutubeId(form.youtube_url) ? (
                    <img
                      src={form.thumbnail || getThumbnail(form.youtube_url)}
                      alt="Short preview"
                      className="w-full h-full object-cover"
                    />
                  ) : form.file_url ? (
                    <video src={form.file_url} className="w-full h-full object-cover" muted playsInline />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />
                  <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-purple-600/90 text-white flex items-center justify-center shadow">
                    <Flame className="w-3 h-3 fill-current" />
                  </span>
                  <p className="absolute bottom-2 inset-x-2 text-[10px] font-bold text-white line-clamp-2 text-right">
                    {form.title || "عنوان المقطع التلقائي"}
                  </p>
                </div>
              </div>
            )}

            <div className={`${(form.youtube_url || form.file_url) ? "sm:col-span-9" : "sm:col-span-12"} space-y-3`}>
              <div>
                <Label className="text-xs">عنوان المقطع القصير (يُجلب تلقائياً أو يُولّد عند الحفظ)</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="اتركه فارغاً ليتم جلبه تلقائياً أو اكتب عنواناً..."
                  className="h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <Label className="text-xs">القناة المرتبطة</Label>
                  <Select
                    value={form.channel_id}
                    onValueChange={(v) => {
                      const ch = channels.find((c) => c.id === v);
                      setForm({
                        ...form,
                        channel_id: v,
                        channel_name: ch ? ch.name : form.channel_name,
                        category: ch?.category || form.category,
                      });
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="اختر قناة" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">اسم القناة</Label>
                  <Input
                    value={form.channel_name}
                    onChange={(e) => setForm({ ...form, channel_name: e.target.value })}
                    placeholder="اسم القناة"
                    className="h-9 text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs">التصنيف</Label>
                  <Input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Switch checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v })} />
                  <span>{form.visible ? "ظاهر للمستخدمين" : "مخفي"}</span>
                </label>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveShort}
                    disabled={saving || uploadingVideo}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{editing ? "حفظ التعديلات" : "حفظ الشورت"}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => { setShowAddForm(false); setEditing(null); }}
                    className="text-xs"
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9:16 Vertical Grid of Shorts */}
      {loading ? (
        <p className="text-center text-sm text-muted-foreground py-8">جاري التحميل...</p>
      ) : filteredShorts.length === 0 ? (
        <div className="text-center py-12 bg-card border border-dashed border-border rounded-2xl p-6 space-y-2">
          <Flame className="w-8 h-8 text-purple-500 fill-current mx-auto opacity-60" />
          <p className="text-sm font-bold">لا توجد مقاطع قصيرة مضافة بعد</p>
          <p className="text-xs text-muted-foreground">
            استخدم صندوق السحب التلقائي أعلاه لجلب المقاطع القصيرة من أي قناة دفعة واحدة، أو أضف مقطعاً بالرابط أو ملف فيديو.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
          {filteredShorts.map((s, idx) => {
            const isSelected = selectedIds.includes(s.id);
            return (
              <div
                key={s.id}
                className={`group rounded-2xl overflow-hidden border bg-card flex flex-col justify-between transition-all ${
                  isSelected ? "border-purple-500 ring-2 ring-purple-500/30" : "border-border"
                } ${!s.visible ? "opacity-50" : ""}`}
              >
                <div
                  className="relative aspect-[9/16] bg-black overflow-hidden cursor-pointer"
                  onClick={() => setPreviewShortIndex(idx)}
                >
                  {(s.thumbnail || extractYoutubeId(s.youtube_url)) ? (
                    <img
                      src={s.thumbnail || getThumbnail(s.youtube_url)}
                      alt={s.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : s.file_url ? (
                    <video src={s.file_url} className="w-full h-full object-cover" muted playsInline />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/30" />

                  {/* Select Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectShort(s.id);
                    }}
                    className={`absolute top-2 left-2 w-7 h-7 rounded-lg flex items-center justify-center shadow transition-colors ${
                      isSelected ? "bg-purple-600 text-white" : "bg-black/60 text-white/80 hover:bg-black/80"
                    }`}
                    title="تحديد المقطع"
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>

                  <span className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-purple-600/90 text-white flex items-center justify-center shadow">
                    <Flame className="w-3.5 h-3.5 fill-current" />
                  </span>

                  {/* Center Play Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="w-11 h-11 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </div>
                  </div>

                  <div className="absolute bottom-2.5 inset-x-2.5 text-right space-y-0.5">
                    <p className="text-xs font-bold text-white line-clamp-2 leading-snug">{s.title}</p>
                    <p className="text-[10px] text-white/75 truncate">{s.channel_name || "بدون قناة"}</p>
                  </div>
                </div>

                <div className="p-2 flex items-center justify-between gap-1 bg-card border-t border-border">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate">
                    {s.category || "عام"}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-purple-600"
                      title="تشغيل ومعاينة الشورت"
                      onClick={() => setPreviewShortIndex(idx)}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={async () => {
                        const nextVis = !s.visible;
                        setShorts((prev) => prev.map((x) => (x.id === s.id ? { ...x, visible: nextVis } : x)));
                        try {
                          await base44.entities.Video.update(s.id, { visible: nextVis });
                        } catch {
                          toast.error("فشل التحديث");
                          await load();
                        }
                      }}
                    >
                      {s.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditing(s);
                        lastFetchedId.current = extractYoutubeId(s.youtube_url) || "";
                        setForm({
                          title: s.title || "",
                          youtube_url: s.youtube_url || "",
                          file_url: s.file_url || "",
                          thumbnail: s.thumbnail || "",
                          channel_id: s.channel_id || "",
                          channel_name: s.channel_name || "",
                          category: s.category || "عام",
                          visible: s.visible !== false,
                          sort_order: s.sort_order || 0,
                        });
                        setShowAddForm(true);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    {confirmDeleteId === s.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => handleDeleteSingleShort(s.id)}
                        >
                          تأكيد
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          إلغاء
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setConfirmDeleteId(s.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewShortIndex !== null && filteredShorts[previewShortIndex] && (
        <ShortsPlayerModal
          shortsList={filteredShorts}
          initialIndex={previewShortIndex}
          onClose={() => setPreviewShortIndex(null)}
        />
      )}

      <ChannelVideosImportModal
        channel={importTargetChannel}
        initialType="shorts"
        isOpen={Boolean(importTargetChannel)}
        onClose={() => setImportTargetChannel(null)}
        onSuccess={load}
      />
    </div>
  );
}

// ─── Regular Videos Tab (Excludes Shorts) ─────────────────────────────────────
function VideosTab() {
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [fetchSuccess, setFetchSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteVideoId, setConfirmDeleteVideoId] = useState(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [confirmBulkDeleteVideos, setConfirmBulkDeleteVideos] = useState(false);
  const lastFetchedVideoId = useRef("");

  const [form, setForm] = useState({
    title: "",
    youtube_url: "",
    description: "",
    channel_id: "",
    channel_name: "",
    category: "عام",
    video_type: "normal",
    duration: "",
    is_featured: false,
    visible: true,
    sort_order: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vData, chData] = await Promise.all([
        base44.entities.Video.list("-created_date", 500),
        base44.entities.VideoChannel.list("sort_order", 200),
      ]);
      // Keep only non-Short videos in VideosTab so Shorts are managed in ShortsTab
      setVideos((vData || []).filter((v) => !isShortRecord(v)));
      setChannels(chData || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Auto-fill video data (title / channel / duration / type) from YouTube URL ──
  const fetchVideoData = useCallback(async (urlToFetch) => {
    const videoId = extractYoutubeId(urlToFetch);
    if (!videoId) return;
    if (lastFetchedVideoId.current === videoId) return;
    lastFetchedVideoId.current = videoId;

    setFetchingMeta(true);
    setFetchSuccess(false);

    try {
      const meta = await fetchVideoMetadata(urlToFetch);
      if (meta) {
        const matchedChannel = channels.find((c) =>
          (c.name && meta.channel_name && (c.name.trim().toLowerCase() === meta.channel_name.trim().toLowerCase() ||
           meta.channel_name.includes(c.name) || c.name.includes(meta.channel_name)))
        );

        setForm((prev) => ({
          ...prev,
          title: meta.title || prev.title,
          channel_name: meta.channel_name || prev.channel_name,
          channel_id: matchedChannel ? matchedChannel.id : prev.channel_id,
          duration: meta.duration || prev.duration,
          video_type: meta.video_type || prev.video_type || "normal",
          description: prev.description ? prev.description : (meta.description || prev.description),
        }));

        setFetchSuccess(true);
        toast.success(`تم جلب بيانات الفيديو: ${meta.title?.slice(0, 30) || "بنجاح"}`);
      }
    } catch (err) {
      console.warn("Video auto-fetch error:", err);
    } finally {
      setFetchingMeta(false);
    }
  }, [channels]);

  useEffect(() => {
    if (!showForm || !form.youtube_url) return;
    const videoId = extractYoutubeId(form.youtube_url);
    if (!videoId) return;

    const timer = setTimeout(() => {
      fetchVideoData(form.youtube_url);
    }, 400);

    return () => clearTimeout(timer);
  }, [form.youtube_url, showForm, fetchVideoData]);

  const handleSave = async () => {
    const rawUrl = (form.youtube_url || "").trim();
    if (!rawUrl) { toast.error("أدخل رابط الفيديو"); return; }
    setSaving(true);
    try {
      let resolvedTitle = (form.title || "").trim();
      const ytId = extractYoutubeId(rawUrl);
      if (!resolvedTitle && ytId) {
        try {
          const meta = await Promise.race([
            fetchVideoMetadata(rawUrl),
            new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);
          if (meta?.title) resolvedTitle = meta.title.trim();
        } catch {}
      }
      const ch = channels.find((c) => c.id === form.channel_id);
      if (!resolvedTitle) {
        resolvedTitle = ch?.name ? `درس — ${ch.name}` : "درس ومحاضرة علمية";
      }
      const thumbnail = getThumbnail(rawUrl);
      const data = {
        ...form,
        title: resolvedTitle,
        thumbnail,
        channel_name: ch?.name || form.channel_name || "",
        video_type: form.video_type || "normal",
      };
      if (editing) {
        await base44.entities.Video.update(editing.id, data);
        toast.success("تم تحديث الفيديو ✓");
      } else {
        await base44.entities.Video.create(data);
        toast.success("تمت إضافة الفيديو ✓");
      }
      setShowForm(false);
      setEditing(null);
      lastFetchedVideoId.current = "";
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
      await load();
    } catch (e) {
      toast.error("فشل الحفظ: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setSaving(false);
    }
  };

  const handleBulkDeleteVideos = async () => {
    if (selectedVideoIds.length === 0) return;
    const toDelete = [...selectedVideoIds];
    setConfirmBulkDeleteVideos(false);
    setSelectedVideoIds([]);
    setVideos((prev) => prev.filter((v) => !toDelete.includes(v.id)));
    try {
      await Promise.all(toDelete.map((id) => base44.entities.Video.delete(id)));
      toast.success(`تم حذف ${toDelete.length} فيديو بنجاح ✓`);
    } catch {
      toast.error("حدث خطأ أثناء حذف بعض الفيديوهات");
      await load();
    }
  };

  const filtered = videos.filter((v) =>
    !search || v.title?.includes(search) || v.category?.includes(search) || v.channel_name?.includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-bold">الفيديوهات والمحاضرات ({videos.length})</h3>
          {filtered.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 px-2"
              onClick={() => {
                if (selectedVideoIds.length === filtered.length) {
                  setSelectedVideoIds([]);
                } else {
                  setSelectedVideoIds(filtered.map((v) => v.id));
                }
              }}
            >
              {selectedVideoIds.length === filtered.length ? (
                <CheckSquare className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <span>{selectedVideoIds.length === filtered.length ? "إلغاء التحديد" : "تحديد الكل"}</span>
            </Button>
          )}
          {selectedVideoIds.length > 0 && (
            confirmBulkDeleteVideos ? (
              <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/30 px-2 py-0.5 rounded-lg">
                <span className="text-[11px] font-bold text-destructive">حذف {selectedVideoIds.length} فيديو؟</span>
                <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={handleBulkDeleteVideos}>
                  تأكيد
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => setConfirmBulkDeleteVideos(false)}>
                  إلغاء
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-[11px] gap-1 px-2.5"
                onClick={() => setConfirmBulkDeleteVideos(true)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف المحدد ({selectedVideoIds.length})</span>
              </Button>
            )
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="بحث..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-36 text-sm"
          />
          <Button size="sm" onClick={() => {
            setEditing(null);
            lastFetchedVideoId.current = "";
            setFetchSuccess(false);
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
              sort_order: videos.length
            });
            setShowForm(true);
          }}>
            <Plus className="w-4 h-4 ml-1" /> إضافة فيديو
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
          {/* URL Input with Instant Auto-fill */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">رابط فيديو اليوتيوب</Label>
              <div className="flex items-center gap-1.5 text-[11px]">
                {fetchingMeta && (
                  <span className="text-primary flex items-center gap-1 animate-pulse font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" /> جلب بيانات الفيديو (العنوان، المدة، القناة)...
                  </span>
                )}
                {fetchSuccess && !fetchingMeta && (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3 h-3" /> تم جلب البيانات تلقائياً
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                value={form.youtube_url}
                onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (pasted) fetchVideoData(pasted);
                }}
                placeholder="https://youtube.com/watch?v=... أو https://youtu.be/..."
                className="h-9 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fetchingMeta || !form.youtube_url}
                onClick={() => fetchVideoData(form.youtube_url)}
                className="shrink-0 h-9 text-xs gap-1"
                title="جلب العنوان والمدة والقناة تلقائياً"
              >
                {fetchingMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-primary" />}
                جلب تلقائي
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              💡 مجرد لصق رابط الفيديو سيتم استخراج وتعبئة العنوان، وقت الفيديو، واسم القناة تلقائياً.
            </p>
          </div>

          {/* Title */}
          <div>
            <Label className="text-xs">
              عنوان الفيديو {fetchingMeta && <Loader2 className="w-3 h-3 inline animate-spin text-primary mr-1" />}
            </Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="عنوان الفيديو (يُجلب تلقائياً من الرابط)"
              className="h-9 text-sm"
            />
          </div>

          {/* Thumbnail & Preview info */}
          {form.youtube_url && extractYoutubeId(form.youtube_url) && (
            <div className="flex items-center gap-3 p-2 rounded-lg bg-card border border-border">
              <div className="relative w-28 aspect-video rounded-md overflow-hidden bg-black/10 shrink-0">
                <img
                  src={getThumbnail(form.youtube_url)}
                  alt="thumbnail"
                  className="w-full h-full object-cover"
                />
                {form.duration && (
                  <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/85 text-white text-[9px] font-mono flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" /> {form.duration}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0 text-xs space-y-0.5">
                <p className="font-bold truncate">{form.title || "عنوان الفيديو"}</p>
                <p className="text-muted-foreground truncate">القناة: {form.channel_name || "غير محدد"}</p>
                {form.duration && <p className="text-primary font-mono text-[11px]">المدة: {form.duration}</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Channel Select or write */}
            <div>
              <Label className="text-xs">القناة المرتبطة</Label>
              <Select
                value={form.channel_id}
                onValueChange={(v) => {
                  const ch = channels.find((c) => c.id === v);
                  setForm({
                    ...form,
                    channel_id: v,
                    channel_name: ch ? ch.name : form.channel_name,
                  });
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="اختر قناة" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">اسم القناة المكتوب</Label>
              <Input
                value={form.channel_name}
                onChange={(e) => setForm({ ...form, channel_name: e.target.value })}
                placeholder="اسم القناة"
                className="h-9 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs">التصنيف</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-9 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs">نوع الفيديو</Label>
              <Select
                value={form.video_type || "normal"}
                onValueChange={(value) => setForm({ ...form, video_type: value })}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">📺 فيديو عادي</SelectItem>
                  <SelectItem value="live">🔴 بث مباشر</SelectItem>
                  <SelectItem value="short">🟣 شورت / قصير</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">وقت الفيديو (المدة)</Label>
              <Input
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                placeholder="مثال: 14:20"
                className="h-9 text-sm font-mono"
              />
            </div>

            <div>
              <Label className="text-xs">الترتيب</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">الوصف</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="وصف الفيديو ومحاوره"
              className="text-sm min-h-[60px]"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={form.is_featured} onCheckedChange={(v) => setForm({ ...form, is_featured: v })} />
              مميز (يظهر في قسم الفيديوهات المميزة)
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v })} />
              {form.visible ? "ظاهر" : "مخفي"}
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Save className="w-4 h-4 ml-1" />}
              {saving ? "جاري الحفظ..." : "حفظ الفيديو"}
            </Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => { setShowForm(false); setEditing(null); }}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-muted-foreground py-8">جاري التحميل...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">لا توجد فيديوهات عادية</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((v) => {
            const isSelected = selectedVideoIds.includes(v.id);
            return (
              <div
                key={v.id}
                className={`bg-card border rounded-xl p-3 transition-all ${
                  isSelected ? "border-primary ring-2 ring-primary/20" : "border-border"
                } ${!v.visible ? "opacity-50" : ""}`}
              >
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedVideoIds((prev) =>
                        prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id]
                      )
                    }
                    className="self-start mt-1 text-muted-foreground hover:text-primary"
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                  </button>
                  <div className="relative w-28 h-20 rounded-lg overflow-hidden shrink-0 bg-muted">
                    {v.thumbnail && (
                      <img src={v.thumbnail} alt={v.title} className="w-full h-full object-cover" />
                    )}
                    {v.duration && (
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/85 text-white text-[9px] font-mono flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" /> {v.duration}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{v.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{v.channel_name || "بدون قناة"}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {v.is_featured && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">مميز</span>}
                      {v.video_type === "live" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-medium">مباشر</span>}
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{v.category}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 mt-2.5 pt-2 border-t border-border/50 justify-end">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                    const nextFeat = !v.is_featured;
                    setVideos((prev) => prev.map((x) => (x.id === v.id ? { ...x, is_featured: nextFeat } : x)));
                    try {
                      await base44.entities.Video.update(v.id, { is_featured: nextFeat });
                    } catch (err) {
                      toast.error("فشل التحديث: " + (err?.message || "خطأ غير معروف"));
                      await load();
                    }
                  }}>{v.is_featured ? <Star className="w-3 h-3 text-amber-500 fill-amber-500" /> : <StarOff className="w-3 h-3" />}</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                    const nextVis = !v.visible;
                    setVideos((prev) => prev.map((x) => (x.id === v.id ? { ...x, visible: nextVis } : x)));
                    try {
                      await base44.entities.Video.update(v.id, { visible: nextVis });
                    } catch (err) {
                      toast.error("فشل التحديث: " + (err?.message || "خطأ غير معروف"));
                      await load();
                    }
                  }}>{v.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                    setEditing(v);
                    lastFetchedVideoId.current = extractYoutubeId(v.youtube_url) || "";
                    setForm({
                      title: v.title,
                      youtube_url: v.youtube_url,
                      description: v.description || "",
                      channel_id: v.channel_id || "",
                      channel_name: v.channel_name || "",
                      category: v.category || "عام",
                      duration: v.duration || "",
                      video_type: v.video_type || "normal",
                      is_featured: v.is_featured,
                      visible: v.visible,
                      sort_order: v.sort_order || 0
                    });
                    setShowForm(true);
                  }}><Pencil className="w-3 h-3" /></Button>
                  {confirmDeleteVideoId === v.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={async () => {
                        setConfirmDeleteVideoId(null);
                        setVideos((prev) => prev.filter((item) => item.id !== v.id));
                        try {
                          await base44.entities.Video.delete(v.id);
                          toast.success("تم حذف الفيديو بنجاح ✓");
                        } catch (err) {
                          toast.error("فشل الحذف: " + (err?.message || "خطأ غير معروف"));
                          await load();
                        }
                      }}>تأكيد</Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setConfirmDeleteVideoId(null)}>
                        إلغاء
                      </Button>
                    </div>
                  ) : (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setConfirmDeleteVideoId(v.id)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function VideoSettingsTab() {
  const [enabled, setEnabled] = useState(() => getSetting("videos_enabled") !== "false");
  const [showInfo, setShowInfo] = useState(() => getSetting("videos_show_info") !== "false");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      setSettings({
        videos_enabled: String(enabled),
        videos_show_info: String(showInfo),
      });
      const res = await flushAllPendingSettings();
      if (res.ok) toast.success("تم حفظ الإعدادات ✓");
      else toast.error("تعذر الحفظ السحابي — سيتم المزامنة عند عودة الاتصال");
    } finally {
      setSaving(false);
    }
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
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
          {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
        </Button>
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
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="videos" className="text-xs gap-1">
            <Video className="w-3.5 h-3.5" /> الفيديوهات
          </TabsTrigger>
          <TabsTrigger value="shorts" className="text-xs gap-1">
            <Flame className="w-3.5 h-3.5 text-purple-500" /> الشورتس
          </TabsTrigger>
          <TabsTrigger value="channels" className="text-xs gap-1">
            <Tv className="w-3.5 h-3.5" /> القنوات
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-xs gap-1">
            <Youtube className="w-3.5 h-3.5" /> الإعدادات
          </TabsTrigger>
        </TabsList>
        <TabsContent value="videos" className="mt-4"><VideosTab /></TabsContent>
        <TabsContent value="shorts" className="mt-4"><ShortsTab /></TabsContent>
        <TabsContent value="channels" className="mt-4"><ChannelsTab /></TabsContent>
        <TabsContent value="settings" className="mt-4"><VideoSettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}