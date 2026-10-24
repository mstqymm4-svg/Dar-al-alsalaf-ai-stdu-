import { useState, useEffect } from "react";
import { useT } from "@/lib/i18n";
import { getVideoChannels } from "@/lib/offlineSync";
import { useContentRefresh } from "@/hooks/useContentSync";

export default function HomeChannels() {
  const t = useT();
  const [channels, setChannels] = useState([]);

  const loadData = () => {
    getVideoChannels().
    then((data) => setChannels((data || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)))).
    catch(() => {});
  };

  useEffect(() => {loadData();}, []);

  useContentRefresh(["channels"], loadData);

  if (channels.length === 0) return null;

  return null;
























































}