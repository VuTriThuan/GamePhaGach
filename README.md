# Phá Gạch · Tự Chơi

Game phá gạch tự chơi trong trình duyệt. Toàn bộ game được vẽ trên một canvas 720 × 1280 (9:16); nút quay nằm ngoài canvas. Không cần tài khoản, máy chủ từ xa, API key hoặc dịch vụ trả phí.

## Chạy trên macOS

Cần Node.js 20 trở lên và npm. Trong thư mục dự án:

```sh
npm install
npm run dev
```

Mở **http://127.0.0.1:5173/**. Game tự chạy ngay khi mở trang; người xem chỉ bấm nút nếu muốn quay. Dùng `npm run build` để tạo bản phát hành trong `dist/`, hoặc `npm run preview` để xem bản build.

## Quay video

Bấm **Bắt đầu quay**, chờ game chạy, bấm **Dừng quay** rồi **Xuất video**. Bản ghi lấy trực tiếp từ `canvas.captureStream(60)`, chỉ có màn hình A ở 720 × 1280; video tiếp tục qua các lần thua và tự bắt đầu ván mới. Ứng dụng ưu tiên MP4 H.264 khi trình duyệt hỗ trợ, rồi thử WebM VP8 và VP9. Phần mở rộng `.webm` hoặc `.mp4` được chọn từ định dạng video thực tế; ứng dụng không chuyển mã. Bản này không ghi âm thanh. Khi trình duyệt hỗ trợ chọn tệp lưu trực tiếp, thanh tiến độ hiển thị phần trăm byte video đã ghi và đạt 100% sau khi tệp được đóng. Trình duyệt không hỗ trợ cách lưu đó sẽ dùng tải xuống thông thường; 100% khi video đã được chuyển cho trình duyệt xử lý. Có thể xuất lại cùng bản ghi sau khi dừng, hoặc bắt đầu bản mới. Sau khi bấm quay, game và video tiếp tục khi bạn chuyển sang cửa sổ khác nhờ đồng hồ Web Audio; máy ngủ hoặc trình duyệt đóng băng tab vẫn có thể làm gián đoạn bản ghi.

Để quay theo lịch, chọn **ngày và giờ bắt đầu** theo giờ địa phương trên máy, nhập **thời lượng (phút)** rồi bấm **Thêm lịch quay**. Có thể thêm nhiều lịch; giờ bắt đầu của lịch mới phải **muộn hơn** giờ kết thúc dự kiến của lịch hợp lệ trước đó (bắt đầu + thời lượng). Từng lịch có nút hủy khi đang chờ. Trang tự bắt đầu quay khi đến giờ, dừng sau thời lượng tính từ lúc thực sự bắt đầu và tự gửi từng tệp MP4/WebM cho trình duyệt tải xuống. Mỗi lịch đã quay có nút **Tải lại video**, kể cả sau khi lịch tiếp theo đã chạy. Nếu một lịch bắt đầu muộn do tab hoặc máy bị tạm ngưng, lịch tiếp theo chờ bản quay trước hoàn tất để không chồng nhau. Giữ trang mở và máy hoạt động cho đến khi hoàn tất; lịch và các bản lưu tạm không tiếp tục nếu đóng hoặc tải lại trang. Khi tab bị treo hoặc máy ngủ, thời điểm bắt đầu và độ dài video thực tế có thể bị lệch.

## Luật và cấu trúc

Mỗi ván mở đầu với **duy nhất một viên gạch số 1**. Từ lượt 2, mỗi lượt thêm gạch mang số lượt tương ứng ở các cột ngẫu nhiên. Vị trí dùng seed để có thể tái hiện, và gạch mới không chồng lên gạch đang có. Số gạch mỗi lượt tăng thêm một sau mỗi 50 lượt, tối đa bốn; các đợt từ hai gạch trở lên có giáp bằng số gạch trong đợt. Bóng thứ hai được mở ở **50 điểm**; mốc cho mỗi bóng tiếp theo gấp **1,5 lần** mốc trước (75, 112,5, 168,75…), theo công thức bóng thứ n mở ở 50 × 1,5^(n−2). Số bóng trở về 1 khi bắt đầu ván mới. Bóng kết thúc lượt khi quay xuống chạm vạch thua; sau đó game chờ **1 giây** trước khi bắn lượt tiếp. Máy thử 51 góc bằng chính phép va chạm của game, chia việc thử góc trong thời gian chờ để tránh đứng hình. Hàng gạch tiến xuống cùng một quãng mỗi lượt.

Vòng vật lý dùng bước cố định 1/120 giây; vị trí bóng được nội suy khi vẽ, và gạch có chuyển động ngắn khi tiến xuống. Mỗi va chạm với gạch thường làm mất 1 HP; gạch có giáp mất 1 HP sau số va chạm bằng mức giáp. Số đang hiển thị luôn là HP thật. Game chỉ thua khi một gạch còn HP chạm vạch thua sau khi gạch tiến xuống, không phụ thuộc số ghi trên gạch. Nếu nhiều gạch cùng chạm vạch, game làm nổi bật gạch còn HP cao nhất. Giá trị ban đầu và HP còn lại của chính gạch đó được hiển thị trên canvas và ghi log trong console; sau 1,7 giây game tự bắt đầu ván mới. Trạng thái quay độc lập với trạng thái ván.

- `src/game/config.ts`: kích thước, tốc độ và seed.
- `src/game/model.ts`, `physics.ts`: đối tượng game và va chạm.
- `src/game/autoPlayer.ts`, `levels.ts`, `game.ts`: chọn góc, sinh gạch và vòng đời ván.
- `src/game/renderer.ts`: toàn bộ khung hình được quay.
- `src/recorder/CanvasRecorder.ts`: trạng thái quay, chọn WebM/MP4 và tải tệp.
- `src/recorder/RecordingSchedule.ts`: quản lý nhiều lịch bắt đầu, dừng và tải video tự động.
- `src/App.tsx`: game loop và vùng điều khiển React.

## Kiểm thử

```sh
npm run build
npm run test:games
npm run test:recorder
```

`test:games` xác nhận vị trí gạch thay đổi theo seed nhưng có thể tái hiện, các gạch mới không chồng nhau và viên gạch gây thua thực sự chạm vạch khi còn HP. Mặc định bài kiểm tra mô phỏng 8 ván liên tiếp. Để thử lâu hơn hoặc đổi seed: `GAME_COUNT=1000 GAME_SEED=42 npm run test:games`. `tests/browser-check.mjs` là bài kiểm tra thủ công hỗ trợ Chrome DevTools ở cổng 9223: quay qua hai lần khởi động lại, tải WebM và kiểm tra bố cục hẹp. Nó chỉ dùng khi chủ động bật Chrome với remote debugging.

Các video mẫu trong `artifacts/` được tạo từ quy tắc cũ, trước khi đổi sang sinh gạch 1, 2, 3… theo từng lượt.
# GamePhaGach
