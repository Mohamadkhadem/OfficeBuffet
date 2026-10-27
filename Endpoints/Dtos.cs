namespace OfficeBuffet.Endpoints;

public record LoginRequest(string Username, string Password);
public record EmployeeLoginRequest(string NationalCode);
public record ChangePasswordRequest(string Current, string New);
public record UserRequest(string Username, string Password);
public record ItemRequest(string Name, string? Category, long Price, bool IsActive = true);
public record PersonRequest(string Name, string? NationalCode, bool IsActive = true);
public record OrderLine(int ItemId, int Quantity);
public record OrderRequest(int PersonId, List<OrderLine> Lines, string? Note, string? Date = null);
public record PaymentRequest(int PersonId, long Amount, string? Note);
public record SettlementRequest(int PersonId, string Until, string UntilLabel, string? Note);
public record VoidRequest(string? Reason);
public record NewPantryRequest(List<OrderLine> Lines, string? Note);
public record PushKeys(string P256dh, string Auth);
public record PushSubscribeRequest(string Endpoint, PushKeys Keys);
public record PushUnsubscribeRequest(string Endpoint);
public record ImportItemRow(int Row, string? Name, string? Price, string? Category);
public record ImportItemsRequest(List<ImportItemRow> Rows, bool Apply);
public record ImportPersonRow(int Row, string? Name, string? NationalCode);
public record ImportPeopleRequest(List<ImportPersonRow> Rows, bool Apply);

public static class ApiErrors
{
    public static IResult Bad(string message) => Results.BadRequest(new { error = message });
    public static IResult Conflict(string message) => Results.Conflict(new { error = message });
    public static IResult NotFound(string message) => Results.NotFound(new { error = message });
}
