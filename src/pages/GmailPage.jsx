import { motion } from "framer-motion";
import { Mail, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import MobileHeader from "@/components/MobileHeader";
import GmailClient from "@/components/GmailClient";
import { Button } from "@/components/ui/button";

export default function GmailPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8" dir="rtl">
      <MobileHeader title="بريد Gmail" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Mail className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                مركز بريد Gmail
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                إدارة رسائلك الإلكترونية ومشاركة الكتب والتوصيات العلمية مباشرة عبر حساب Google الخاص بك
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/books">
              <Button variant="outline" size="sm" className="gap-1.5 rounded-xl text-xs">
                <ExternalLink className="w-3.5 h-3.5" />
                تصفح المكتبة للمشاركة
              </Button>
            </Link>
          </div>
        </div>

        <GmailClient />
      </motion.div>
    </div>
  );
}
