import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Modal, Textarea, showError, useToast } from "@/components/ui";
import { isBackfillDateValid } from "@/domain/adherence";
import { measurementRepo } from "@/db/repositories";
import { todayStr } from "@/db/client";
import { addDays, fmtDate } from "@/lib/date";

/** 可复用的体重记录弹窗（S03 / SRS 表 7-4）：回车保存、默认上次值、补记 30 天、稍后、今天不再。 */
export function WeightModal({
  userId,
  onClose,
  onSaved,
  onSnooze,
  onTodayOff,
  reminder = false,
}: {
  userId: string;
  onClose: () => void;
  onSaved?: () => void;
  onSnooze?: () => void;
  onTodayOff?: () => void;
  reminder?: boolean;
}) {
  const { show } = useToast();
  const today = todayStr();
  const { data: latest } = useQuery({
    queryKey: ["measurement", "latest", userId],
    queryFn: () => measurementRepo.latest(userId),
    enabled: !!userId,
  });
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (latest && weight === "") setWeight(String(latest.weight_kg));
  }, [latest]); // 默认上次值（FR-REC-01）

  const save = async () => {
    try {
      if (!isBackfillDateValid(date, today)) throw new Error("只能补记今天或过去 30 天内的日期");
      await measurementRepo.saveOnDate(
        userId,
        date,
        Number(weight),
        waist.trim() === "" ? null : Number(waist),
        note.trim() || null,
      );
      onSaved?.();
      onClose();
    } catch (e) {
      showError(e, show); // FR-REC-07 写失败保留输入
    }
  };

  return (
    <Modal
      title={reminder ? "该记录今天的体重了" : "记体重"}
      onClose={onClose}
      footer={
        reminder ? (
          <>
            {onTodayOff && <Button variant="ghost" onClick={onTodayOff}>今天不再</Button>}
            {onSnooze && <Button variant="secondary" onClick={onSnooze}>稍后 10 分钟</Button>}
            <Button onClick={save}>保存</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button onClick={save}>保存</Button>
          </>
        )
      }
    >
      <Field label="日期" hint="可补记过去 30 天，未来日期不可选">
        <Input type="date" value={date} max={today} min={fmtDate(addDays(new Date(), -30))} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="体重（kg）" hint="20–300 kg，±0.1；回车保存">
        <Input
          autoFocus
          type="number"
          step="0.1"
          min={20}
          max={300}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        />
      </Field>
      <Field label="腰围（cm，可选）" hint="30–200 cm，±0.5">
        <Input type="number" step="0.5" min={30} max={200} value={waist} onChange={(e) => setWaist(e.target.value)} />
      </Field>
      <Field label="备注（可选）">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}
