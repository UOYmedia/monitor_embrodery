# Hỏi Grafana bằng Claude — máy chủ MCP

Cho phép người khác mở Claude (Claude Code, hoặc Claude Desktop) rồi hỏi thẳng bằng tiếng Việt:
*"máy nào đang chạy?"*, *"hôm nay máy 621294 dừng mấy lần?"*, *"vẽ giúp biểu đồ mũi thêu 4 tiếng qua"* —
Claude tự viết LogQL, tự gọi Grafana, tự đọc kết quả.

Dùng [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) — máy chủ MCP chính chủ của
Grafana Labs. Đã chạy thật ở đây: **68 công cụ**, đọc được Loki `loki-dahao` và cả hai bảng
`dahao-tinh-trang`, `dahao-tuyen`.

## Đã dựng sẵn những gì

| Thứ | Ở đâu |
|---|---|
| Nhị phân `mcp-grafana` 1.2.0 | Mini, `brew install mcp-grafana` |
| Tài khoản dịch vụ Grafana `claude-mcp`, quyền **Viewer** | Grafana, id = 2 |
| Token của tài khoản đó | `~/dahao-gateway/quan-sat/mcp-grafana.env` (chmod 600) |
| Cấu hình mẫu | `.mcp.json` ở gốc repo |

**Quyền Viewer là ranh giới an toàn thật.** `mcp-grafana` có sẵn công cụ ghi
(`update_dashboard`, `create_datasource`, `install_plugin`…) và **không có cờ chỉ-đọc**. Chặn thật
nằm ở phía Grafana: token mang vai Viewer nên mọi lệnh ghi bị Grafana trả 403. Đừng cấp vai Editor
hay Admin cho token này.

## Người khác dùng thế nào

Mỗi người cài nhị phân trên máy mình rồi khai một lần. Không cần vào tailnet — đi qua
`https://grafana.phonh.io.vn`.

**1. Cài (macOS):**

```sh
brew install mcp-grafana
```

Windows/Linux: tải bản phát hành ở https://github.com/grafana/mcp-grafana/releases

**2. Khai vào Claude Code:**

```sh
claude mcp add grafana --scope user \
  --env GRAFANA_URL=https://grafana.phonh.io.vn \
  --env GRAFANA_SERVICE_ACCOUNT_TOKEN=<dán token vào đây> \
  -- mcp-grafana -t stdio
```

**3. Kiểm:** mở `claude`, gõ `/mcp` — phải thấy `grafana` ✓ connected. Rồi thử hỏi
*"liệt kê nguồn dữ liệu trong Grafana"*.

### Lấy token để đưa cho người ta

Token chỉ hiện **đúng một lần** lúc tạo, nên nó nằm trong tệp. Trên Mini:

```sh
grep TOKEN ~/dahao-gateway/quan-sat/mcp-grafana.env
```

Cần token mới (người cũ nghỉ, lộ token…): chạy lại `quan-sat/mcp/tao-token-mcp.sh`. Script tạo
thêm token mới cho cùng tài khoản dịch vụ và ghi đè tệp. Thu hồi token cũ ở Grafana →
Administration → Users and access → Service accounts → `claude-mcp`.

⚠ **Token này mở toàn bộ Grafana ở mức đọc**, tức là đọc được log thô của xưởng. Đưa cho ai là cân
nhắc như đưa mật khẩu Grafana ở mức xem. Mỗi người một token thì thu hồi lẻ được — script chạy bao
nhiêu lần cũng ra bấy nhiêu token, đặt tên theo ngày giờ.

## Vì sao chạy trên máy từng người, không dựng một máy chủ MCP chung

`mcp-grafana` có chế độ `-t streamable-http` để dựng một điểm chung, ai cũng trỏ vào, khỏi cài gì.
Nhưng nó **không tự xác thực người gọi** — đưa lên internet là ai mò ra URL cũng đọc được số liệu
xưởng. Muốn làm thì phải thêm một tầng đăng nhập trước nó (Cloudflare Access chẳng hạn). Chưa làm.

## Nó hỏi được những gì

Đã chạy thật, có số trả về:

- `list_datasources` → `loki-dahao`
- `list_loki_label_names` → `dong, filename, job, ket_qua, loai, may, may_gom, service_name, tep, tinh_trang, trang_thai, vai, xuong`
- `query_loki_logs` với `{job="tinh-trang"}` → dòng tình trạng máy thật, có `tinh_trang`, `ma`, `mui`, `tong`, `mau`
- `search_dashboards`, `get_dashboard_panel_queries` → đọc được câu truy vấn đang lưu trong bảng
- `get_panel_image` → xuất ảnh một ô bảng (cần plugin render, chưa thử)

Hai luồng đang có trong Loki:

| job | là gì |
|---|---|
| `tinh-trang` | kết luận của bridge — đúng thứ trang `test.phonh.io.vn` vẽ. Có `ma` 0..6 để đếm. |
| `broker` | mã máy tự khai (`state` 0/2/15/−1) + số mũi. Dùng khi nghi bridge phân loại sai. |
