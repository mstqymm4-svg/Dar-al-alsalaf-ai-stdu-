import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { getVideoChannels } from "@/lib/offlineSync";
import { useContentRefresh } from "@/hooks/useContentSync";
import { Tv } from "lucide-react";
import SmartImage from "./SmartImage";

export default function HomeChannels() {
  const t = useT();
  const [channels, setChannels] = useState([]);

  const loadData = () => {
    getVideoChannels()
      .then((data) =>
        setChannels((data || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)))
      )
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

  useContentRefresh(["channels"], loadData);

  if (!channels || channels.length === 0) return null;

  // Show only 1 or 2 channels on Home page as requested
  const featuredChannels = channels.slice(0, 2);

  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Tv className="w-4 h-4 text-primary" />
        </span>
        <h2 className="text-lg sm:text-xl font-bold text-foreground">
          {t.channelsTitle || "قنوات الدروس"}
        </h2>
      </div>

      <div className={`grid gap-3 sm:gap-4 ${featuredChannels.length === 1 ? "grid-cols-1 max-w-md mx-auto" : "grid-cols-1 sm:grid-cols-2"}`}>
        {featuredChannels.map((channel) => {
          const logoSrc = channel.channel_logo || channel.thumbnail_url || channel.logo_url;
          return (
            <Link
              key={channel.id}
              to={`/videos?channel=${encodeURIComponent(channel.id)}`}
              className="group flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/80 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 active:scale-98"
            >
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden bg-muted border-2 border-border/60 group-hover:border-primary/50 group-hover:scale-105 transition-all duration-300 shadow-sm flex items-center justify-center shrink-0">
                {logoSrc ? (
                  <SmartImage
                    src={logoSrc}
                    alt={channel.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Tv className="w-7 h-7 text-muted-foreground/40" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm sm:text-base text-foreground truncate group-hover:text-primary transition-colors">
                  {channel.name}
                </h3>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}