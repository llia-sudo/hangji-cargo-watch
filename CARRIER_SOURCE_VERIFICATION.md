# 全球前十大班轮公司官网船期源验证

验证日期：2026-08-16（Asia/Shanghai）

判定规则：只有后端实际取得结构化船期，并严格匹配船名、航次、启运港和目的港，才标记为“自动回填”。人工网页能免费查询但服务器请求被验证码、WAF 或 OAuth 拦截时，不标记为自动。

| 船公司 | 官网查询页 | 反查样例（船名 / 航次 / POL → POD） | 验证结果 |
|---|---|---|---|
| MSC | https://www.msc.com/en/search-a-schedule | MSC SANTA MARIA / NC606A / LIVERPOOL → ANTWERP | 官网样例可核对；匿名服务端请求被 Akamai 拒绝，开发者接口需要登录和订阅授权，标记为“需授权” |
| Maersk | https://www.maersk.com/schedules/vesselSchedules | MAERSK RIO NEGRO / 623N / SYDNEY → SINGAPORE | **代码实时通过**：ATD 2026-06-02 16:41，ATA 2026-07-07 17:55，航线 071；已接入自动回填 |
| CMA CGM | https://www.cma-cgm.com/ebusiness/schedules/voyage | TOLEDO TRIUMPH / 0TSNEW1MA / SAVANNAH → NEW YORK | 已定位官方 `/vesseloperation/voyage/v2` 接口；匿名请求返回 401，必须提供 `KeyId`，标记为“需授权” |
| COSCO | https://elines.coscoshipping.com/ebusiness/sailingSchedule/searchByVesselName/resultByVoyage | CONCERTO / 599E / SHANGHAI → INCHON | **代码实时通过**：ETD 2026-08-20 23:00，ETA 2026-08-22 02:00，航线 AK47 |
| Hapag-Lloyd | https://www.hapag-lloyd.com/solutions/schedule/ | JPO VENUS / 629S / MERSIN → PORT SAID | 已定位官方 DCSA OVS v3 接口；匿名请求返回 401，必须提供 `X-IBM-Client-Id` 和 `X-IBM-Client-Secret`，标记为“需授权” |
| ONE | https://ecomm.one-line.com/one-ecom/schedule/vessel-schedule | ONE CONTRIBUTION / 066W / PUSAN → NINGBO | **代码实时通过**：ATD 2026-08-14 09:52，ETA 2026-08-15 17:00，航线 PS3 |
| Evergreen | https://ss.shipmentlink.com/tvs2/jsp/TVS2_ShowVesselSchedule.jsp | EVER URBAN / 1542-139W / SHANGHAI → JEBEL ALI | 官网船名船期页可核对；现有自动回填使用 ShipmentLink 箱号节点，船名船期适配器待单独接入 |
| HMM | https://www.hmm21.com/e-service/general/schedule/ScheduleMain.do | HMM ALGECIRAS / 020W / QINGDAO → NINGBO | **代码实时通过**：ATD 2026-06-21 02:33，ATA 2026-06-22 16:53，航线 FE3 |
| Yang Ming | https://www.yangming.com/en/esolution/schedule/vessel_schedule | YM WORLD / 049W / NINGBO → SINGAPORE | **代码实时通过**：ATD 2026-08-05 08:00，ATA 2026-08-15 17:45，航线 MD1 |
| ZIM | https://www.zim.com/schedules/schedule-by-vessel | ZIM SAN DIEGO / 076W / XINGANG → HAIFA | ZIM 官方接口要求免费账户、产品订阅和 OAuth Client Credentials，标记为“需授权” |

## 已实施的防错条件

- 船名必须完全一致（忽略空格和标点）。
- 航次必须完全一致；只允许用数字部分定位 ONE 的内部航次，再用联盟航次二次确认。
- POL、POD 必须真实存在于同一航次港序；不再拿首港或末港代替未匹配港口。
- 实际到离港时间只在官网状态为 Actual 时写入 ATD/ATA。
- 当前航次不符时，Yang Ming 最多查询相邻航次；仍不符则返回未更新。
