import { motion } from "framer-motion";
import { Play, Heart, Share2, Star, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import SmartImage from "./SmartImage";

export default function VideoCard({ video, isFavorite, onToggleFavorite, onPlay, onShare, index = 0 }) {
  const t = useT();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.3) }}
      className="bg-card border border-border rounded-2xl overflow-hidden group hover:shadow-xl hover:shadow-primary/10 hover:-translate-y-1 hover:border-primary/30 transition-all duration-300">
      
      {/* Thumbnail */}
      <div className="relative aspect-video bg-muted cursor-pointer" onClick={() => onPlay(video)}>
        {video.thumbnail &&
        <SmartImage
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          fallback={() => <Video className="w-8 h-8 text-muted-foreground/30" />} />

        }
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100">
          <div className="w-12 h-12 rounded-full bg-primary/90 flex items-center justify-center">
            <Play className="w-5 h-5 text-primary-foreground fill-primary-foreground mr-0.5" />
          </div>
        </div>
        {video.duration &&
        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> {video.duration}
          </span>
        }
        {video.is_featured &&
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center gap-1 shadow-md">
            <Star className="w-2.5 h-2.5 fill-white" /> {t.featured}
          </span>
        }
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-bold line-clamp-2 mb-1 text-base">{video.title}</h3>
        {video.channel_name && <p className="text-xs text-muted-foreground mb-1">{video.channel_name}</p>}
        {video.description && <p className="text-[10px] text-muted-foreground line-clamp-2 mb-2">{video.description}</p>}
        <div className="flex items-center gap-1">
          <Button size="sm" className="flex-1 h-8 text-xs gap-1 rounded-[4px_20px_4px_20px]" onClick={() => onPlay(video)}>
            <Play className="w-3.5 h-3.5" /> {t.play}
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" title={isFavorite ? t.removeFav : t.addFav} onClick={() => onToggleFavorite(video.id)}>
            <Heart className={`w-3.5 h-3.5 ${isFavorite ? "fill-red-500 text-red-500" : ""}`} />
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onShare(video)}>
            <Share2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>);

}